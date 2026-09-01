import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm'

import { db } from '@/server/db'
import {
  agentJobs,
  backupArtifacts,
  backupRuns,
  aliases,
  deployments,
  deploymentLogs,
  environments,
  projects,
} from '@/server/db/schema'
import { createInstallationAccessToken } from '@/server/github/service'
import { queueBackupRetentionCleanupJobs } from '@/server/backups/service'
import {
  decryptDeploymentEnvVars,
  parseDeploymentConfig,
  toDeploymentCommitMeta,
} from '@/server/projects/deployment-config'
import type { DeploymentConfig } from '@/server/projects/deployment-config'
import { requireAgentServer } from '@/server/servers/service'
import { AgentRequestError } from './protocol'
import { decryptSecret } from '@/server/secrets/crypto'
import {
  currentAgentProtocolVersion,
  hasAgentCapability,
} from './compatibility'
import {
  parseBackupCleanupPayload,
  parseBackupPayload,
  parseDeprovisionPayload,
  parseRestorePayload,
} from './job-payloads'
import type {
  AgentBackupCleanupCompletion,
  AgentBackupCleanupJob,
  AgentBackupCompletion,
  AgentBackupJob,
  AgentCleanupCompletion,
  AgentCleanupJob,
  AgentDeployJob,
  AgentJob,
  AgentJobCompletion,
  AgentJobProgress,
  AgentJobStatus,
  AgentRestoreCompletion,
  AgentRestoreJob,
  AgentEnvVar,
} from './protocol'

type InstallationAccessTokenFactory = typeof createInstallationAccessToken

export async function claimNextAgentJob({
  serverId,
  token,
  protocolVersion,
  capabilities,
  createAccessToken = createInstallationAccessToken,
}: {
  serverId: string
  token: string
  protocolVersion?: number
  capabilities?: Array<string>
  createAccessToken?: InstallationAccessTokenFactory
}): Promise<AgentJob | null> {
  const server = await requireAgentServer({ serverId, token })
  await Promise.all([
    failStaleRunningDeploymentsForServer(serverId),
    failStaleRunningAgentJobsForServer(serverId),
  ])

  if (protocolVersion !== currentAgentProtocolVersion) {
    return null
  }

  const cleanupJob = hasAgentCapability(capabilities, 'jobs.compose.cleanup.v1')
    ? await claimNextCleanupJob({ serverId })
    : null

  if (cleanupJob) {
    return cleanupJob
  }

  if (server.status === 'deleted') {
    return hasAgentCapability(capabilities, 'jobs.compose.deploy.v1')
      ? claimNextDeploymentJob({
          serverId,
          token,
          createAccessToken,
          skipAgentAuth: true,
        })
      : null
  }

  const backupTypes = [
    ...(hasAgentCapability(capabilities, 'jobs.backup.v1')
      ? (['backup'] as const)
      : []),
    ...(hasAgentCapability(capabilities, 'jobs.backup.cleanup.v1')
      ? (['backup_cleanup'] as const)
      : []),
    ...(hasAgentCapability(capabilities, 'jobs.restore.v1')
      ? (['restore'] as const)
      : []),
  ]
  const backupJob =
    backupTypes.length > 0
      ? await claimNextBackupJob({ serverId, types: backupTypes })
      : null

  if (backupJob) {
    return backupJob
  }

  return hasAgentCapability(capabilities, 'jobs.compose.deploy.v1')
    ? claimNextDeploymentJob({
        serverId,
        token,
        createAccessToken,
        skipAgentAuth: true,
      })
    : null
}

async function claimNextBackupJob({
  serverId,
  types,
}: {
  serverId: string
  types: Array<'backup' | 'restore' | 'backup_cleanup'>
}): Promise<AgentBackupJob | AgentBackupCleanupJob | AgentRestoreJob | null> {
  const now = new Date()
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ job: agentJobs })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.serverId, serverId),
          inArray(agentJobs.type, types),
          eq(agentJobs.status, 'queued'),
          lte(agentJobs.availableAt, now),
        ),
      )
      .orderBy(asc(agentJobs.createdAt))
      .limit(1)
    const row = rows.at(0)

    if (!row) {
      return null
    }

    const claimedRows = await tx
      .update(agentJobs)
      .set({
        status: 'running',
        attempt: row.job.attempt + 1,
        claimedAt: now,
        updatedAt: now,
      })
      .where(and(eq(agentJobs.id, row.job.id), eq(agentJobs.status, 'queued')))
      .returning({ id: agentJobs.id })

    if (!claimedRows.at(0)) {
      return null
    }

    if (row.job.type === 'backup') {
      const payload = parseBackupPayload(row.job.payload)

      if (!payload) {
        return row.job
      }

      await tx
        .update(backupRuns)
        .set({
          status: 'running',
          startedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(backupRuns.id, payload.backupRunId),
            eq(backupRuns.status, 'queued'),
          ),
        )
    }

    return row.job
  })

  if (!claimed) {
    return null
  }

  if (claimed.type === 'backup') {
    const payload = parseBackupPayload(claimed.payload)

    if (!payload) {
      await failCleanupJob(claimed.id, 'Backup job payload is invalid.')
      return null
    }

    return {
      type: 'backup',
      id: claimed.id,
      backup: hydrateBackupPayload(payload),
    }
  }

  if (claimed.type === 'backup_cleanup') {
    const payload = parseBackupCleanupPayload(claimed.payload)

    if (!payload) {
      await failCleanupJob(claimed.id, 'Backup cleanup job payload is invalid.')
      return null
    }

    return {
      type: 'backup_cleanup',
      id: claimed.id,
      cleanup: hydrateBackupCleanupPayload(payload),
    }
  }

  if (claimed.type === 'restore') {
    const payload = parseRestorePayload(claimed.payload)

    if (!payload) {
      await failCleanupJob(claimed.id, 'Restore job payload is invalid.')
      return null
    }

    return {
      type: 'restore',
      id: claimed.id,
      restore: hydrateRestorePayload(payload),
    }
  }

  return null
}

function hydrateBackupPayload(
  payload: NonNullable<ReturnType<typeof parseBackupPayload>>,
) {
  return {
    ...payload,
    destination: hydrateBackupDestination(payload.destination),
  }
}

function hydrateBackupCleanupPayload(
  payload: NonNullable<ReturnType<typeof parseBackupCleanupPayload>>,
) {
  return {
    ...payload,
    ...(payload.destination
      ? { destination: hydrateBackupDestination(payload.destination) }
      : {}),
  }
}

function hydrateRestorePayload(
  payload: NonNullable<ReturnType<typeof parseRestorePayload>>,
) {
  return {
    ...payload,
    ...(payload.destination
      ? { destination: hydrateBackupDestination(payload.destination) }
      : {}),
  }
}

function hydrateBackupDestination<
  T extends {
    secretAccessKey?: string
    secretAccessKeyCiphertext?: string
  },
>(destination: T) {
  const { secretAccessKeyCiphertext, ...rest } = destination

  return {
    ...rest,
    ...(secretAccessKeyCiphertext
      ? { secretAccessKey: decryptSecret(secretAccessKeyCiphertext) }
      : {}),
  }
}

export async function claimNextDeploymentJob({
  serverId,
  token,
  createAccessToken = createInstallationAccessToken,
  skipAgentAuth = false,
}: {
  serverId: string
  token: string
  createAccessToken?: InstallationAccessTokenFactory
  skipAgentAuth?: boolean
}): Promise<AgentDeployJob | null> {
  if (!skipAgentAuth) {
    await requireAgentServer({ serverId, token })
    await failStaleRunningDeploymentsForServer(serverId)
  }

  const claimed = await db
    .transaction(async (tx) => {
      const rows = await tx
        .select({
          deployment: deployments,
          environment: environments,
          project: projects,
        })
        .from(deployments)
        .innerJoin(environments, eq(environments.id, deployments.environmentId))
        .innerJoin(projects, eq(projects.id, environments.projectId))
        .where(
          and(
            eq(deployments.serverId, serverId),
            eq(deployments.status, 'queued'),
            runtimeHasNoRunningDeployment(),
          ),
        )
        .orderBy(asc(deployments.createdAt))
        .limit(1)
      const row = rows.at(0)

      if (!row) {
        return null
      }

      const claimedRows = await tx
        .update(deployments)
        .set({
          status: 'running',
          phase: 'agent_connected',
          startedAt: new Date(),
        })
        .where(
          and(
            eq(deployments.id, row.deployment.id),
            eq(deployments.status, 'queued'),
            runtimeHasNoRunningDeployment(),
          ),
        )
        .returning({ id: deployments.id })

      if (!claimedRows.at(0)) {
        return null
      }

      return row
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error)) {
        return null
      }

      throw error
    })

  if (!claimed) {
    return null
  }

  const deploymentConfig = parseDeploymentConfig(claimed.deployment.config)

  if (!deploymentConfig) {
    await failClaimedDeployment(
      claimed.deployment.id,
      'Deployment config is invalid.',
    )
    return null
  }

  if (!claimed.project.githubInstallationId || !claimed.deployment.repoId) {
    await failClaimedDeployment(
      claimed.deployment.id,
      'Project is missing a GitHub App installation.',
    )
    return null
  }

  let accessToken: { token: string }
  try {
    accessToken = await createAccessToken({
      installationId: claimed.project.githubInstallationId,
      repositoryId: claimed.deployment.repoId,
      repositoryFullName: claimed.deployment.repoFullName,
    })
  } catch (error) {
    await failClaimedDeployment(
      claimed.deployment.id,
      error instanceof Error
        ? error.message
        : 'Unable to create GitHub installation token.',
    )
    return null
  }
  let envVars: Array<AgentEnvVar>

  try {
    envVars = decryptDeploymentEnvVars(claimed.deployment.envVars)
  } catch (error) {
    await failClaimedDeployment(
      claimed.deployment.id,
      error instanceof Error
        ? error.message
        : 'Unable to decrypt deployment environment variables.',
    )
    return null
  }

  const runtimeEnvVars = buildAgentDeploymentEnvVars({
    deployment: claimed.deployment,
    environment: claimed.environment,
    envVars,
    project: claimed.project,
    config: deploymentConfig,
  })

  return {
    type: 'deploy',
    id: claimed.deployment.id,
    logStartSeq: await getNextLogSeq(claimed.deployment.id),
    repo: {
      fullName: claimed.deployment.repoFullName,
      branch: claimed.deployment.gitBranch,
      sha: claimed.deployment.gitSha,
      token: accessToken.token,
    },
    project: {
      name: claimed.project.name,
    },
    runtime: {
      ...deploymentConfig.runtime,
      path: deploymentConfig.runtime.path ?? 'compose.yml',
      projectName: claimed.deployment.runtimeId,
      action: claimed.deployment.trigger === 'rollback' ? 'rollback' : 'deploy',
    },
    envVars: runtimeEnvVars,
    routes: deploymentConfig.routes,
  }
}

export function buildAgentDeploymentEnvVars({
  deployment,
  environment,
  envVars,
  project,
  config,
}: {
  deployment: {
    id: string
    createdAt: Date
    gitBranch: string
    gitSha: string
    commitMeta: unknown
    repoFullName: string
  }
  environment: {
    id: string
    slug: string
  }
  envVars: Array<AgentEnvVar>
  project: {
    id: string
    teamId: string
  }
  config: DeploymentConfig
}) {
  const next = [...envVars]
  const rawCommitMeta =
    typeof deployment.commitMeta === 'object' && deployment.commitMeta !== null
      ? (deployment.commitMeta as {
          authorName?: string | null
          authoredAt?: string | null
          message?: string | null
          url?: string | null
        })
      : {}
  const commitMeta = toDeploymentCommitMeta({
    authorName: rawCommitMeta.authorName,
    authoredAt: rawCommitMeta.authoredAt,
    message: rawCommitMeta.message ?? null,
    url: rawCommitMeta.url,
  })
  const [repoOwner, repoName] = deployment.repoFullName.split('/', 2)
  const defaultRoute = config.routes.at(0)
  const runtimeVars: Record<string, string | null | undefined> = {
    DEVPUSH: 'true',
    DEVPUSH_URL: defaultRoute
      ? `${defaultRoute.https ? 'https' : 'http'}://${defaultRoute.host}`
      : null,
    DEVPUSH_DOMAIN: defaultRoute?.host,
    DEVPUSH_TEAM_ID: project.teamId,
    DEVPUSH_PROJECT_ID: project.id,
    DEVPUSH_ENVIRONMENT: environment.slug || environment.id,
    DEVPUSH_DEPLOYMENT_ID: deployment.id,
    DEVPUSH_DEPLOYMENT_CREATED_AT: deployment.createdAt.toISOString(),
    DEVPUSH_GIT_PROVIDER: 'github',
    DEVPUSH_GIT_REPO: deployment.repoFullName,
    DEVPUSH_GIT_REF: deployment.gitBranch,
    DEVPUSH_GIT_COMMIT_SHA: deployment.gitSha,
    DEVPUSH_GIT_COMMIT_AUTHOR: commitMeta.authorName,
    DEVPUSH_GIT_COMMIT_MESSAGE: commitMeta.message,
    DEVPUSH_GIT_REPO_OWNER: repoOwner,
    DEVPUSH_GIT_REPO_NAME: repoName,
  }

  for (const [key, value] of Object.entries(runtimeVars)) {
    if (value && !next.some((envVar) => envVar.key === key)) {
      next.push({ key, value })
    }
  }

  return next
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

async function claimNextCleanupJob({
  serverId,
}: {
  serverId: string
}): Promise<AgentCleanupJob | null> {
  const now = new Date()
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ job: agentJobs })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.serverId, serverId),
          inArray(agentJobs.type, ['deprovision', 'purge']),
          eq(agentJobs.status, 'queued'),
          lte(agentJobs.availableAt, now),
        ),
      )
      .orderBy(asc(agentJobs.createdAt))
      .limit(1)
    const row = rows.at(0)

    if (!row) {
      return null
    }

    const claimedRows = await tx
      .update(agentJobs)
      .set({
        status: 'running',
        attempt: row.job.attempt + 1,
        claimedAt: now,
        updatedAt: now,
      })
      .where(and(eq(agentJobs.id, row.job.id), eq(agentJobs.status, 'queued')))
      .returning({ id: agentJobs.id })

    if (!claimedRows.at(0)) {
      return null
    }

    return row.job
  })

  if (!claimed) {
    return null
  }

  if (claimed.type !== 'deprovision' && claimed.type !== 'purge') {
    await failCleanupJob(
      claimed.id,
      `Unsupported agent job type "${claimed.type}".`,
    )
    return null
  }

  const payload = parseDeprovisionPayload(claimed.payload)

  if (!payload) {
    await failCleanupJob(claimed.id, 'Cleanup job payload is invalid.')
    return null
  }

  return {
    type: claimed.type,
    id: claimed.id,
    cleanup: {
      runtimeIds: payload.runtimeIds,
      removeVolumes: payload.removeVolumes,
      reason: payload.reason,
    },
  }
}

export async function failStaleRunningDeploymentsForServer(serverId: string) {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const staleRows = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.serverId, serverId),
        eq(deployments.status, 'running'),
        lt(deployments.startedAt, cutoff),
      ),
    )
  const staleIds = staleRows.map((row) => row.id)

  if (staleIds.length === 0) {
    return []
  }

  const nextSeqRows = await db
    .select({
      deploymentId: deploymentLogs.deploymentId,
      value: sql<number>`coalesce(max(${deploymentLogs.seq}), 0) + 1`,
    })
    .from(deploymentLogs)
    .where(inArray(deploymentLogs.deploymentId, staleIds))
    .groupBy(deploymentLogs.deploymentId)
  const nextSeqByDeployment = new Map(
    nextSeqRows.map((row) => [row.deploymentId, Number(row.value)]),
  )
  const message = 'Deployment timed out after the agent stopped reporting.'

  return db.transaction(async (tx) => {
    const failedRows = await tx
      .update(deployments)
      .set({
        status: 'failed',
        phase: 'timed_out',
        errorMessage: message,
        finishedAt: new Date(),
      })
      .where(
        and(
          inArray(deployments.id, staleIds),
          eq(deployments.status, 'running'),
        ),
      )
      .returning({ id: deployments.id })
    const failedIds = failedRows.map((row) => row.id)

    if (failedIds.length === 0) {
      return []
    }

    await tx.insert(deploymentLogs).values(
      failedIds.map((deploymentId) => ({
        deploymentId,
        stream: 'deploy',
        seq: nextSeqByDeployment.get(deploymentId) ?? 1,
        content: message,
      })),
    )

    return failedIds
  })
}

export async function failStaleRunningAgentJobsForServer(serverId: string) {
  const now = new Date()
  const runningRows = await db
    .select({ job: agentJobs })
    .from(agentJobs)
    .where(
      and(eq(agentJobs.serverId, serverId), eq(agentJobs.status, 'running')),
    )
  const stale = runningRows.filter(({ job }) => {
    if (!job.claimedAt) return true
    const timeoutMs =
      job.type === 'backup' ||
      job.type === 'backup_cleanup' ||
      job.type === 'restore'
        ? 25 * 60 * 60 * 1000
        : 3 * 60 * 60 * 1000
    return job.claimedAt.getTime() < now.getTime() - timeoutMs
  })

  if (stale.length === 0) {
    return []
  }

  const jobIds = stale.map(({ job }) => job.id)
  const backupRunIds = stale.flatMap(({ job }) => {
    if (job.type !== 'backup') return []
    const payload = parseBackupPayload(job.payload)
    return payload ? [payload.backupRunId] : []
  })
  const message = 'Agent job timed out before completion was reported.'

  return db.transaction(async (tx) => {
    const failed = await tx
      .update(agentJobs)
      .set({
        status: 'failed',
        errorMessage: message,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(inArray(agentJobs.id, jobIds), eq(agentJobs.status, 'running')),
      )
      .returning({ id: agentJobs.id })

    if (backupRunIds.length > 0) {
      await tx
        .update(backupRuns)
        .set({
          status: 'failed',
          errorMessage: message,
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            inArray(backupRuns.id, backupRunIds),
            eq(backupRuns.status, 'running'),
          ),
        )
    }

    return failed
  })
}

export async function getDeploymentJobStatus({
  serverId,
  token,
  deploymentId,
}: {
  serverId: string
  token: string
  deploymentId: string
}): Promise<AgentJobStatus> {
  await requireAgentServer({ serverId, token })

  const rows = await db
    .select({ status: deployments.status })
    .from(deployments)
    .where(
      and(eq(deployments.id, deploymentId), eq(deployments.serverId, serverId)),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new AgentRequestError(404, 'Deployment not found for this server.')
  }

  return {
    deploymentId,
    status: row.status,
  }
}

export async function completeDeploymentJob({
  serverId,
  token,
  completion,
}: {
  serverId: string
  token: string
  completion: AgentJobCompletion
}) {
  await requireAgentServer({ serverId, token })

  const rows = await db
    .select({
      deployment: deployments,
      projectId: environments.projectId,
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .where(
      and(
        eq(deployments.id, completion.deploymentId),
        eq(deployments.serverId, serverId),
      ),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new AgentRequestError(404, 'Deployment not found for this server.')
  }

  if (row.deployment.status === 'canceled') {
    return { ok: true, ignored: true }
  }

  if (row.deployment.status !== 'running') {
    throw new AgentRequestError(409, 'Deployment is not running.')
  }

  const now = new Date()
  const latestEvent = completion.events.at(-1)
  const latestMessage = getLatestProgressMessage(completion)

  await db.transaction(async (tx) => {
    const completedRows = await tx
      .update(deployments)
      .set({
        status: completion.status,
        phase:
          completion.status === 'canceled'
            ? 'canceled'
            : (latestEvent?.phase ?? 'completed'),
        gitSha: completion.gitSha ?? row.deployment.gitSha,
        errorMessage:
          completion.status === 'failed'
            ? latestMessage
            : completion.status === 'canceled'
              ? latestMessage
              : row.deployment.errorMessage,
        finishedAt: now,
      })
      .where(
        and(
          eq(deployments.id, completion.deploymentId),
          eq(deployments.status, 'running'),
        ),
      )
      .returning({ id: deployments.id })

    if (!completedRows.at(0)) {
      return
    }

    await appendDeploymentProgress(
      tx,
      {
        deploymentId: completion.deploymentId,
        logStartSeq:
          completion.logStartSeq ??
          (await getNextLogSeq(completion.deploymentId)),
        logs: completion.logs,
        events: completion.events,
      },
      { updatePhase: false },
    )

    if (completion.status === 'succeeded') {
      await tx
        .update(aliases)
        .set({
          previousDeploymentId: sql`${aliases.deploymentId}`,
          deploymentId: completion.deploymentId,
          updatedAt: now,
        })
        .where(
          and(
            eq(aliases.projectId, row.projectId),
            eq(aliases.environmentId, row.deployment.environmentId),
            or(
              eq(aliases.type, 'environment'),
              and(
                eq(aliases.type, 'branch'),
                eq(aliases.branch, row.deployment.gitBranch),
              ),
            ),
          ),
        )
    }
  })

  return { ok: true }
}

export async function completeCleanupJob({
  serverId,
  token,
  completion,
}: {
  serverId: string
  token: string
  completion: AgentCleanupCompletion
}) {
  await requireAgentServer({
    serverId,
    token,
    cleanupJobId: completion.jobId,
  })

  const rows = await db
    .select({ job: agentJobs })
    .from(agentJobs)
    .where(
      and(eq(agentJobs.id, completion.jobId), eq(agentJobs.serverId, serverId)),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new AgentRequestError(404, 'Cleanup job not found for this server.')
  }

  if (row.job.status !== 'running') {
    return { ok: true, ignored: true }
  }

  const now = new Date()

  await db
    .update(agentJobs)
    .set({
      status: completion.status,
      errorMessage:
        completion.status === 'failed'
          ? (completion.message ?? 'Cleanup failed.')
          : null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(eq(agentJobs.id, completion.jobId), eq(agentJobs.status, 'running')),
    )

  return { ok: true }
}

export async function completeBackupJob({
  serverId,
  token,
  completion,
}: {
  serverId: string
  token: string
  completion: AgentBackupCompletion
}) {
  await requireAgentServer({ serverId, token })

  const rows = await db
    .select({ job: agentJobs, backupRun: backupRuns })
    .from(agentJobs)
    .innerJoin(backupRuns, eq(backupRuns.id, completion.backupRunId))
    .where(
      and(
        eq(agentJobs.id, completion.jobId),
        eq(agentJobs.serverId, serverId),
        eq(agentJobs.type, 'backup'),
        eq(backupRuns.id, completion.backupRunId),
        eq(backupRuns.serverId, serverId),
      ),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new AgentRequestError(404, 'Backup job not found for this server.')
  }

  if (row.job.status !== 'running') {
    return { ok: true, ignored: true }
  }

  const now = new Date()
  const errorMessage =
    completion.status === 'failed'
      ? (completion.message ?? 'Backup failed.')
      : completion.status === 'canceled'
        ? (completion.message ?? 'Backup canceled.')
        : null

  await db.transaction(async (tx) => {
    if (completion.status === 'succeeded' && completion.artifacts?.length) {
      await tx
        .insert(backupArtifacts)
        .values(
          completion.artifacts.map((artifact) => ({
            id: randomUUID(),
            backupRunId: completion.backupRunId,
            type: artifact.type,
            storage: artifact.storage,
            objectKey: artifact.objectKey,
            checksumSha256: artifact.checksumSha256,
            sizeBytes: artifact.sizeBytes,
            createdAt: now,
          })),
        )
        .onConflictDoNothing({
          target: [backupArtifacts.backupRunId, backupArtifacts.objectKey],
        })
    }

    await tx
      .update(backupRuns)
      .set({
        status: completion.status,
        manifest: completion.manifest ?? row.backupRun.manifest,
        errorMessage,
        startedAt: row.backupRun.startedAt ?? now,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(backupRuns.id, completion.backupRunId),
          eq(backupRuns.status, 'running'),
        ),
      )

    await tx
      .update(agentJobs)
      .set({
        status: completion.status,
        errorMessage,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentJobs.id, completion.jobId),
          eq(agentJobs.status, 'running'),
        ),
      )
  })

  if (completion.status === 'succeeded') {
    await queueBackupRetentionCleanupJobs({
      projectId: row.backupRun.projectId,
      environmentId: row.backupRun.environmentId,
      now,
    })
  }

  return { ok: true }
}

export async function completeBackupCleanupJob({
  serverId,
  token,
  completion,
}: {
  serverId: string
  token: string
  completion: AgentBackupCleanupCompletion
}) {
  await requireAgentServer({ serverId, token })

  const rows = await db
    .select({ job: agentJobs })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.id, completion.jobId),
        eq(agentJobs.serverId, serverId),
        eq(agentJobs.type, 'backup_cleanup'),
      ),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new AgentRequestError(
      404,
      'Backup cleanup job not found for this server.',
    )
  }

  if (row.job.status !== 'running') {
    return { ok: true, ignored: true }
  }

  const backupRunIds = Array.from(
    new Set(completion.backupRunIds.map((id) => id.trim()).filter(Boolean)),
  )

  if (backupRunIds.length === 0) {
    throw new AgentRequestError(
      409,
      'Backup cleanup completion must include backup runs.',
    )
  }

  const now = new Date()
  const errorMessage =
    completion.status === 'failed'
      ? (completion.message ?? 'Backup cleanup failed.')
      : completion.status === 'canceled'
        ? (completion.message ?? 'Backup cleanup canceled.')
        : null

  await db.transaction(async (tx) => {
    const backupRunPatch = {
      cleanupErrorMessage: errorMessage,
      updatedAt: now,
      ...(completion.status === 'succeeded' ? { cleanupFinishedAt: now } : {}),
    }

    await tx
      .update(backupRuns)
      .set(backupRunPatch)
      .where(
        and(
          inArray(backupRuns.id, backupRunIds),
          eq(backupRuns.serverId, serverId),
        ),
      )

    await tx
      .update(agentJobs)
      .set({
        status: completion.status,
        errorMessage,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentJobs.id, completion.jobId),
          eq(agentJobs.status, 'running'),
        ),
      )
  })

  return { ok: true }
}

export async function completeRestoreJob({
  serverId,
  token,
  completion,
}: {
  serverId: string
  token: string
  completion: AgentRestoreCompletion
}) {
  await requireAgentServer({ serverId, token })

  const rows = await db
    .select({ job: agentJobs })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.id, completion.jobId),
        eq(agentJobs.serverId, serverId),
        eq(agentJobs.type, 'restore'),
      ),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new AgentRequestError(404, 'Restore job not found for this server.')
  }

  if (row.job.status !== 'running') {
    return { ok: true, ignored: true }
  }

  const now = new Date()
  const errorMessage =
    completion.status === 'failed'
      ? (completion.message ?? 'Restore failed.')
      : completion.status === 'canceled'
        ? (completion.message ?? 'Restore canceled.')
        : null

  await db
    .update(agentJobs)
    .set({
      status: completion.status,
      errorMessage,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(eq(agentJobs.id, completion.jobId), eq(agentJobs.status, 'running')),
    )

  return { ok: true }
}

export async function recordDeploymentProgress({
  serverId,
  token,
  progress,
}: {
  serverId: string
  token: string
  progress: AgentJobProgress
}) {
  await requireAgentServer({ serverId, token })

  const rows = await db
    .select({
      deployment: deployments,
    })
    .from(deployments)
    .where(
      and(
        eq(deployments.id, progress.deploymentId),
        eq(deployments.serverId, serverId),
      ),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new AgentRequestError(404, 'Deployment not found for this server.')
  }

  if (row.deployment.status === 'canceled') {
    return { ok: true, ignored: true }
  }

  if (row.deployment.status !== 'running') {
    throw new AgentRequestError(409, 'Deployment is not running.')
  }

  await db.transaction(async (tx) => {
    await appendDeploymentProgress(tx, progress, { requireRunning: true })
  })

  return { ok: true }
}

async function failCleanupJob(jobId: string, message: string) {
  await db
    .update(agentJobs)
    .set({
      status: 'failed',
      errorMessage: message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentJobs.id, jobId))
}

function runtimeHasNoRunningDeployment() {
  return sql`not exists (
    select 1
    from deployments as running_deployments
    where running_deployments.runtime_id = ${deployments.runtimeId}
      and running_deployments.status = 'running'
  )`
}

async function appendDeploymentProgress(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  progress: AgentJobProgress,
  options: {
    requireRunning?: boolean
    updatePhase?: boolean
  } = {},
) {
  if (options.requireRunning) {
    const runningRows = await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.id, progress.deploymentId),
          eq(deployments.status, 'running'),
        ),
      )
      .limit(1)

    if (!runningRows.at(0)) {
      return
    }
  }

  if (options.updatePhase !== false && progress.events.length > 0) {
    const latestEvent = progress.events.at(-1)

    if (latestEvent) {
      await tx
        .update(deployments)
        .set({ phase: latestEvent.phase })
        .where(
          options.requireRunning
            ? and(
                eq(deployments.id, progress.deploymentId),
                eq(deployments.status, 'running'),
              )
            : eq(deployments.id, progress.deploymentId),
        )
    }
  }

  if (progress.logs.length > 0) {
    await tx
      .insert(deploymentLogs)
      .values(
        progress.logs.map((line, index) => ({
          deploymentId: progress.deploymentId,
          stream: 'deploy',
          seq: progress.logStartSeq + index,
          content: line,
        })),
      )
      .onConflictDoNothing({
        target: [
          deploymentLogs.deploymentId,
          deploymentLogs.stream,
          deploymentLogs.seq,
        ],
      })
  }
}

async function failClaimedDeployment(deploymentId: string, message: string) {
  const nextSeq = await getNextLogSeq(deploymentId)

  await db.transaction(async (tx) => {
    const failedRows = await tx
      .update(deployments)
      .set({
        status: 'failed',
        phase: 'failed',
        errorMessage: message,
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(deployments.id, deploymentId),
          eq(deployments.status, 'running'),
        ),
      )
      .returning({ id: deployments.id })

    if (failedRows.at(0)) {
      await tx.insert(deploymentLogs).values({
        deploymentId,
        stream: 'deploy',
        seq: nextSeq,
        content: message,
      })
    }
  })
}

async function getNextLogSeq(deploymentId: string) {
  const nextSeqRows = await db
    .select({
      value: sql<number>`coalesce(max(${deploymentLogs.seq}), 0) + 1`,
    })
    .from(deploymentLogs)
    .where(eq(deploymentLogs.deploymentId, deploymentId))

  return Number(nextSeqRows.at(0)?.value ?? 1)
}

function getLatestProgressMessage(progress: AgentJobCompletion) {
  return progress.events.at(-1)?.message ?? progress.logs.at(-1) ?? null
}
