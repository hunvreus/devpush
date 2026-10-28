import {
  withWorkspaceAccess,
  isWorkspacePolicyRefusal,
} from '#devpush/server/plugins/workspace-access'
import type { BackupDestination } from '#devpush/server/backups/service'
import { backupDestinationSnapshot } from '#devpush/server/backups/destination'
import { refreshBackupCredentials } from '#devpush/server/backups/storage'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { config as serverConfig } from '#devpush/server/config'
import {
  recoverStaleCleanupJobs,
  finishContainerCleanup,
} from './container-cleanup-state'
import {
  failStaleAgentJob,
  failClaimedAgentJob,
  finishBackup,
  finishBackupCleanup,
} from './backup-state'
import { claimBackupCandidate, claimCleanup, claimDeployment } from './claims'
import { failRunningDeployments, finishDeployment } from './deployment-state'
import { isAbsolute, relative } from 'node:path/posix'

import { and, asc, eq, inArray, lt, lte, or, isNull, sql } from 'drizzle-orm'

import { db } from '#devpush/server/db'
import { notifyServer } from '#devpush/server/realtime/service'
import {
  appendDeploymentLogs,
  nextDeploymentLogSeq,
} from '#devpush/server/logs/deployments'
import {
  agentJobs,
  aliases,
  backupRuns,
  deployments,
  environments,
  projects,
  servers,
} from '#devpush/server/db/schema'
import { createInstallationAccessToken } from '#devpush/server/github/service'
import { queueBackupRetentionCleanupJobs } from '#devpush/server/backups/service'
import {
  decryptDeploymentEnvVars,
  parseDeploymentConfig,
  toDeploymentCommitMeta,
} from '#devpush/server/projects/deployment-config'
import type { DeploymentConfig } from '#devpush/server/projects/deployment-config'
import { requireAgentServer } from '#devpush/server/servers/service'
import { AgentRequestError } from './protocol'
import { decryptSecret } from '#devpush/server/secrets/crypto'
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
  if (server.status !== 'deleted')
    await recoverStaleCleanupJobs(db, { serverId, now: new Date() })
  await Promise.all([
    failStaleRunningDeployments(serverId),
    failStaleAgentJobs(serverId),
  ])

  if (protocolVersion !== currentAgentProtocolVersion) {
    return null
  }

  const cleanupJob = hasAgentCapability(capabilities, 'jobs.compose.cleanup.v2')
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
      ? await claimNextBackupJob({
          serverId,
          types: backupTypes,
        })
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
  const [owner] = await db
    .select({ teamId: servers.teamId })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1)
  if (!owner) return null
  const teamId = owner.teamId
  let claimed: typeof agentJobs.$inferSelect | null = null
  // A lost compare-and-set means another request consumed this candidate.
  // Read the next one immediately instead of delaying it until another poll.
  for (let attempt = 0; !claimed && attempt < 8; attempt++) {
    const now = new Date()
    const [snapshot] = await db
      .select({
        job: agentJobs,
        payloadSnapshot: sql<string>`${agentJobs.payload}`,
      })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.serverId, serverId),
          inArray(agentJobs.type, types),
          eq(agentJobs.status, 'queued'),
          lte(agentJobs.availableAt, now),
        ),
      )
      .orderBy(asc(agentJobs.createdAt), asc(agentJobs.id))
      .limit(1)
    if (!snapshot) return null
    const candidate = snapshot.job
    const payload =
      candidate.type === 'backup' ? parseBackupPayload(candidate.payload) : null
    try {
      const claim = () =>
        claimBackupCandidate(db, {
          job: candidate,
          payloadSnapshot: snapshot.payloadSnapshot,
          backupRunId: payload?.backupRunId ?? null,
          now,
        })
      claimed =
        candidate.type === 'backup_cleanup'
          ? await claim()
          : await withWorkspaceAccess(
              teamId,
              candidate.type === 'restore' ? 'restore.claim' : 'backup.claim',
              claim,
              { kind: 'system', source: 'agent' },
            )
    } catch (error) {
      if (!isWorkspacePolicyRefusal(error)) throw error
      // Skip productive work but continue looking for retention cleanup.
      return types.includes('backup_cleanup')
        ? claimNextBackupJob({ serverId, types: ['backup_cleanup'] })
        : null
    }
  }

  if (!claimed) return null

  try {
    if (claimed.type === 'backup') {
      const payload = parseBackupPayload(claimed.payload)

      if (!payload) {
        await failCleanupJob(claimed.id, 'Backup job payload is invalid.')
        return null
      }

      return {
        type: 'backup',
        id: claimed.id,
        backup: await hydrateBackupPayload(payload, teamId),
      }
    }

    if (claimed.type === 'backup_cleanup') {
      const payload = parseBackupCleanupPayload(claimed.payload)

      if (!payload) {
        await failCleanupJob(
          claimed.id,
          'Backup cleanup job payload is invalid.',
        )
        return null
      }

      return {
        type: 'backup_cleanup',
        id: claimed.id,
        cleanup: await hydrateBackupCleanupPayload(payload, teamId),
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
        restore: await hydrateRestorePayload(payload, teamId),
      }
    }

    return null
  } catch (error) {
    const payload =
      claimed.type === 'backup' ? parseBackupPayload(claimed.payload) : null
    const cleanup =
      claimed.type === 'backup_cleanup'
        ? parseBackupCleanupPayload(claimed.payload)
        : null
    await failClaimedAgentJob(db, {
      job: claimed,
      now: new Date(),
      message: getPublicErrorMessage(
        error,
        'Backup storage credentials could not be loaded.',
      ),
      backupRunId: payload?.backupRunId ?? null,
      cleanupRunIds: cleanup?.backupRunIds ?? [],
    })
    return null
  }
}

async function hydrateBackupPayload(
  payload: NonNullable<ReturnType<typeof parseBackupPayload>>,
  teamId: string,
) {
  return {
    ...payload,
    destination: await hydrateBackupDestination(
      teamId,
      payload.destination,
      payload.retention.remote.enabled,
    ),
  }
}
async function hydrateBackupCleanupPayload(
  payload: NonNullable<ReturnType<typeof parseBackupCleanupPayload>>,
  teamId: string,
) {
  return {
    ...payload,
    ...(payload.destination
      ? {
          destination: await hydrateBackupDestination(
            teamId,
            payload.destination,
            payload.remoteObjectKeys.length > 0,
          ),
        }
      : {}),
  }
}
async function hydrateRestorePayload(
  payload: NonNullable<ReturnType<typeof parseRestorePayload>>,
  teamId: string,
) {
  return {
    ...payload,
    ...(payload.destination
      ? {
          destination: await hydrateBackupDestination(
            teamId,
            payload.destination,
            payload.artifacts.some((artifact) => artifact.storage === 'remote'),
          ),
        }
      : {}),
  }
}
async function hydrateBackupDestination(
  teamId: string,
  destination: BackupDestination,
  remote: boolean,
) {
  const snapshot = backupDestinationSnapshot(destination)
  if (!remote) return snapshot
  const current = await refreshBackupCredentials(teamId, snapshot)
  if (!current.secretAccessKeyCiphertext)
    throw new Error('Backup storage credentials missing.')
  return {
    ...snapshot,
    accessKeyId: current.accessKeyId,
    secretAccessKey: decryptSecret(current.secretAccessKeyCiphertext),
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
    await failStaleRunningDeployments(serverId)
  }

  await failStaleQueuedDeployments(serverId)
  const deployment = await claimDeployment(db, serverId, new Date())
  if (!deployment) return null
  const [identity] = await db
    .select({ environment: environments, project: projects })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(environments.id, deployment.environmentId))
    .limit(1)
  const claimed = identity ? { deployment, ...identity } : null

  if (!claimed) {
    await failClaimedDeployment(
      deployment.id,
      'Deployment environment no longer exists.',
    )
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

  const [deploymentAlias] = await db
    .select({ hostname: aliases.hostname })
    .from(aliases)
    .where(
      and(
        eq(aliases.deploymentId, claimed.deployment.id),
        eq(aliases.type, 'deployment'),
      ),
    )
    .limit(1)

  return {
    fallbackHost: deploymentAlias?.hostname,
    type: 'deploy',
    id: claimed.deployment.id,
    logStartSeq: await nextDeploymentLogSeq(claimed.deployment.id),
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

async function claimNextCleanupJob({
  serverId,
}: {
  serverId: string
}): Promise<AgentCleanupJob | null> {
  const claimed = await claimCleanup(db, serverId, new Date())

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

  // A previously orphaned runtime may have been assigned back before this job
  // became available. Never execute an old purge against a currently owned runtime.
  const protectedRows = await db
    .select({ runtimeId: environments.runtimeId })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(
        eq(environments.status, 'active'),
        sql`coalesce(${environments.serverId}, ${projects.defaultServerId}) = ${serverId}`,
        sql`${environments.runtimeId} in (select value from json_each(${JSON.stringify(payload.runtimeIds)}))`,
      ),
    )
  const activeRows = await db
    .select({ runtimeId: deployments.runtimeId })
    .from(deployments)
    .where(
      and(
        eq(deployments.serverId, serverId),
        inArray(deployments.status, ['queued', 'running']),
        sql`${deployments.runtimeId} in (select value from json_each(${JSON.stringify(payload.runtimeIds)}))`,
      ),
    )
  const protectedIds = new Set(
    [...protectedRows, ...activeRows].map((row) => row.runtimeId),
  )
  const runtimeIds = payload.runtimeIds.filter((id) => !protectedIds.has(id))
  if (runtimeIds.length === 0) {
    await finishContainerCleanup(db, {
      job: claimed,
      completion: {
        jobId: claimed.id,
        attempt: claimed.attempt,
        status: 'succeeded',
      },
      now: new Date(),
    })
    return null
  }

  if (runtimeIds.length !== payload.runtimeIds.length) {
    const trimmed = await db
      .update(agentJobs)
      .set({ payload: { ...payload, runtimeIds } })
      .where(
        and(
          eq(agentJobs.id, claimed.id),
          eq(agentJobs.status, 'running'),
          eq(agentJobs.attempt, claimed.attempt),
          sql`${agentJobs.claimedAt} is ${claimed.claimedAt?.getTime() ?? null}`,
        ),
      )
      .returning({ id: agentJobs.id })
    if (trimmed.length === 0) return null
  }

  return {
    type: claimed.type,
    id: claimed.id,
    attempt: claimed.attempt,
    cleanup: {
      runtimeIds,
      removeVolumes: payload.removeVolumes,
      reason: payload.reason,
    },
  }
}

const deploymentTimeoutMs = 3 * 60 * 60 * 1000
const lostAgentTimeoutMs = 10 * 60 * 1000
const backupJobTimeoutMs = 25 * 60 * 60 * 1000

function agentJobTimeoutMs(type: string) {
  return type === 'backup' || type === 'backup_cleanup' || type === 'restore'
    ? backupJobTimeoutMs
    : deploymentTimeoutMs
}

export async function failStaleQueuedDeployments(
  serverId?: string,
  now = new Date(),
) {
  const cutoff = new Date(
    now.getTime() - serverConfig.DEVPUSH_DEPLOYMENT_QUEUE_TTL_HOURS * 60 * 60 * 1000,
  )
  const changed = await db
    .update(deployments)
    .set({
      status: 'failed',
      phase: 'timed_out',
      errorMessage: 'Deployment expired while waiting for the server.',
      finishedAt: now,
    })
    .where(
      and(
        eq(deployments.status, 'queued'),
        lte(deployments.createdAt, cutoff),
        serverId ? eq(deployments.serverId, serverId) : undefined,
      ),
    )
    .returning({ id: deployments.id, serverId: deployments.serverId })
  await Promise.all(
    [...new Set(changed.map((row) => row.serverId))].map((id) =>
      notifyServer(id, 'deployments'),
    ),
  )
  return changed.map((row) => row.id)
}

export async function failStaleRunningDeployments(serverId?: string) {
  const now = new Date()
  const cutoff = new Date(now.getTime() - deploymentTimeoutMs)
  const heartbeatCutoff = new Date(now.getTime() - lostAgentTimeoutMs)
  const staleRows = await db
    .select({
      id: deployments.id,
      serverId: deployments.serverId,
      startedAt: deployments.startedAt,
    })
    .from(deployments)
    .innerJoin(servers, eq(servers.id, deployments.serverId))
    .where(
      and(
        serverId ? eq(deployments.serverId, serverId) : undefined,
        eq(deployments.status, 'running'),
        or(
          lt(deployments.startedAt, cutoff),
          and(
            lt(deployments.startedAt, heartbeatCutoff),
            or(
              isNull(servers.lastSeenAt),
              lt(servers.lastSeenAt, heartbeatCutoff),
            ),
          ),
        ),
      ),
    )
  const expired = staleRows.filter(
    (row) => row.startedAt && row.startedAt < cutoff,
  )
  const disconnected = staleRows.filter((row) => !expired.includes(row))
  const failed = [
    ...(await failRunningDeployments(db, {
      ids: expired.map((row) => row.id),
      message: 'Deployment exceeded the three-hour execution limit.',
      phase: 'timed_out',
      startedBefore: cutoff,
      now,
    })),
    ...(await failRunningDeployments(db, {
      ids: disconnected.map((row) => row.id),
      message:
        'Deployment failed after ten minutes without an agent heartbeat.',
      phase: 'timed_out',
      startedBefore: heartbeatCutoff,
      heartbeatBefore: heartbeatCutoff,
      now,
    })),
  ]
  const failedIds = new Set(failed)
  const affectedServers = new Set(
    staleRows.filter((row) => failedIds.has(row.id)).map((row) => row.serverId),
  )
  await Promise.all(
    [...affectedServers].map((id) => notifyServer(id, 'deployments')),
  )
  return failed
}

export async function failStaleAgentJobs(serverId?: string) {
  const now = new Date()
  const cutoff = now.getTime() - backupJobTimeoutMs
  const stale = await db
    .select({
      job: agentJobs,
      payloadSnapshot: sql<string>`${agentJobs.payload}`,
    })
    .from(agentJobs)
    .where(
      and(
        serverId ? eq(agentJobs.serverId, serverId) : undefined,
        sql`${agentJobs.type} in ('backup', 'restore', 'backup_cleanup')`,
        sql`((${agentJobs.status} = 'running' and (${agentJobs.claimedAt} is null or ${agentJobs.claimedAt} < ${cutoff}))
        or (${agentJobs.status} = 'queued' and ${agentJobs.availableAt} < ${cutoff}))`,
      ),
    )
    .orderBy(asc(agentJobs.availableAt))
    .limit(500)
  const failed: Array<{ id: string }> = []
  const affectedServers = new Set<string>()
  for (const { job, payloadSnapshot } of stale) {
    const backup =
      job.type === 'backup' ? parseBackupPayload(job.payload) : null
    const cleanup =
      job.type === 'backup_cleanup'
        ? parseBackupCleanupPayload(job.payload)
        : null
    if (
      await failStaleAgentJob(db, {
        job,
        payloadSnapshot,
        now,
        timeoutMs: agentJobTimeoutMs(job.type),
        message: 'Agent job timed out before completion was reported.',
        backupRunId: backup?.backupRunId ?? null,
        cleanupRunIds: cleanup?.backupRunIds ?? [],
      })
    ) {
      failed.push({ id: job.id })
      affectedServers.add(job.serverId)
    }
  }
  await Promise.all(
    [...affectedServers].map((id) => notifyServer(id, 'deployments')),
  )
  return failed
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

  const terminal = ['canceled', 'failed', 'succeeded'].includes(
    row.deployment.status,
  )
  if (!terminal && row.deployment.status !== 'running') {
    throw new AgentRequestError(409, 'Deployment is not running.')
  }

  // Commit captured output before changing main state. Stable sequences make a
  // retry safe after either store succeeds but the response is lost.
  await appendDeploymentLogs(
    {
      projectId: row.projectId,
      environmentId: row.deployment.environmentId,
      deploymentId: row.deployment.id,
      serverId,
      branch: row.deployment.gitBranch,
    },
    completion.logStartSeq,
    completion.logs,
  )
  if (terminal) return { ok: true, ignored: true }

  const now = new Date()
  const latestEvent = completion.events.at(-1)
  const latestMessage = getLatestProgressMessage(completion)

  await finishDeployment(db, {
    deployment: row.deployment,
    projectId: row.projectId,
    status: completion.status,
    phase:
      completion.status === 'canceled'
        ? 'canceled'
        : (latestEvent?.phase ?? 'completed'),
    // Preserve the queued full commit ID for later redeployments.
    gitSha: row.deployment.gitSha,
    errorMessage:
      completion.status === 'failed' || completion.status === 'canceled'
        ? latestMessage
        : row.deployment.errorMessage,
    now,
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
      and(
        eq(agentJobs.id, completion.jobId),
        eq(agentJobs.serverId, serverId),
        inArray(agentJobs.type, ['deprovision', 'purge']),
      ),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new AgentRequestError(404, 'Cleanup job not found for this server.')
  }

  if (row.job.status !== 'running' || row.job.attempt !== completion.attempt) {
    return { ok: true, ignored: true }
  }

  const changed = await finishContainerCleanup(db, {
    job: row.job,
    completion,
    now: new Date(),
  })
  if (!changed) return { ok: true, ignored: true }

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

  const payload = parseBackupPayload(row.job.payload)
  if (!payload || payload.backupRunId !== completion.backupRunId) {
    throw new AgentRequestError(
      409,
      'Backup completion does not match the claimed job.',
    )
  }

  for (const artifact of completion.artifacts ?? []) {
    if (
      (artifact.storage === 'local' &&
        !pathIsWithin(payload.localBasePath, artifact.objectKey)) ||
      (artifact.storage === 'remote' &&
        !remoteKeyIsWithin(payload.artifactPrefix, artifact.objectKey))
    ) {
      throw new AgentRequestError(
        409,
        'Backup artifact is outside the claimed backup location.',
      )
    }
  }

  const now = new Date()
  const errorMessage =
    completion.status === 'failed'
      ? (completion.message ?? 'Backup failed.')
      : completion.status === 'canceled'
        ? (completion.message ?? 'Backup canceled.')
        : null

  const changed = await finishBackup(db, {
    serverId,
    completion,
    errorMessage,
    now,
    manifest: completion.manifest ?? row.backupRun.manifest,
  })

  if (
    changed &&
    (completion.status === 'succeeded' ||
      (completion.status === 'failed' &&
        typeof completion.manifest === 'object' &&
        completion.manifest !== null &&
        'localRecoveryAvailable' in completion.manifest &&
        completion.manifest.localRecoveryAvailable === true))
  ) {
    await queueBackupRetentionCleanupJobs({
      projectId: row.backupRun.projectId,
      environmentId: row.backupRun.environmentId,
      now,
    })
  }

  return { ok: true }
}

function pathIsWithin(root: string, candidate: string) {
  if (!isAbsolute(root) || !isAbsolute(candidate)) return false
  const path = relative(root, candidate)
  return path !== '' && path !== '..' && !path.startsWith('../')
}

function remoteKeyIsWithin(prefix: string, candidate: string) {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '')
  const normalizedCandidate = candidate.replace(/^\/+/, '')
  return (
    normalizedPrefix !== '' &&
    normalizedCandidate.startsWith(`${normalizedPrefix}/`) &&
    !normalizedCandidate.split('/').includes('..')
  )
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

  const payload = parseBackupCleanupPayload(row.job.payload)
  if (!payload) {
    throw new AgentRequestError(409, 'Backup cleanup job payload is invalid.')
  }
  const reportedBackupRunIds = Array.from(
    new Set(completion.backupRunIds.map((id) => id.trim()).filter(Boolean)),
  ).sort()
  const backupRunIds = Array.from(new Set(payload.backupRunIds)).sort()

  if (
    backupRunIds.length === 0 ||
    reportedBackupRunIds.length !== backupRunIds.length ||
    reportedBackupRunIds.some((id, index) => id !== backupRunIds[index])
  ) {
    throw new AgentRequestError(
      409,
      'Backup cleanup completion does not match the claimed job.',
    )
  }

  const now = new Date()
  const errorMessage =
    completion.status === 'failed'
      ? (completion.message ?? 'Backup cleanup failed.')
      : completion.status === 'canceled'
        ? (completion.message ?? 'Backup cleanup canceled.')
        : null

  await finishBackupCleanup(db, {
    serverId,
    completion,
    errorMessage,
    now,
    backupRunIds,
    localObjectKeys: payload.localObjectKeys,
    remoteObjectKeys: payload.remoteObjectKeys,
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
    .select({ deployment: deployments, projectId: environments.projectId })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
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

  const terminal = ['canceled', 'failed', 'succeeded'].includes(
    row.deployment.status,
  )
  if (!terminal && row.deployment.status !== 'running') {
    throw new AgentRequestError(409, 'Deployment is not running.')
  }

  await appendDeploymentLogs(
    {
      projectId: row.projectId,
      environmentId: row.deployment.environmentId,
      deploymentId: row.deployment.id,
      serverId,
      branch: row.deployment.gitBranch,
    },
    progress.logStartSeq,
    progress.logs,
  )
  if (terminal) return { ok: true, ignored: true }
  const latestEvent = progress.events.at(-1)
  if (latestEvent) {
    await db
      .update(deployments)
      .set({ phase: latestEvent.phase })
      .where(
        and(
          eq(deployments.id, progress.deploymentId),
          eq(deployments.status, 'running'),
        ),
      )
  }

  return { ok: true }
}

async function failCleanupJob(jobId: string, message: string) {
  const changed = await db
    .update(agentJobs)
    .set({
      status: 'failed',
      errorMessage: message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentJobs.id, jobId))
    .returning({ serverId: agentJobs.serverId })
  if (changed[0]) await notifyServer(changed[0].serverId, 'deployments')
}

async function failClaimedDeployment(deploymentId: string, message: string) {
  const changed = await failRunningDeployments(db, {
    ids: [deploymentId],
    message,
    phase: 'failed',
    now: new Date(),
  })
  if (changed.length === 0) return
  const [deployment] = await db
    .select({ serverId: deployments.serverId })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1)
  if (deployment?.serverId)
    await notifyServer(deployment.serverId, 'deployments')
}

function getLatestProgressMessage(progress: AgentJobCompletion) {
  return progress.events.at(-1)?.message ?? progress.logs.at(-1) ?? null
}
