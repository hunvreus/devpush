import {
  failStaleAgentJob,
  finishBackup,
  finishBackupCleanup,
} from './backup-state'
import { claimBackupCandidate, claimCleanup, claimDeployment } from './claims'
import { failRunningDeployments, finishDeployment } from './deployment-state'
import { isAbsolute, relative } from 'node:path/posix'

import { and, asc, eq, inArray, lt, lte } from 'drizzle-orm'

import { db } from '@/server/db'
import { notifyServer } from '@/server/realtime/service'
import {
  appendDeploymentLogs,
  nextDeploymentLogSeq,
} from '@/server/logs/deployments'
import {
  agentJobs,
  backupRuns,
  deployments,
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
    failStaleRunningDeployments(serverId),
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
  let claimed: typeof agentJobs.$inferSelect | null = null
  // A lost compare-and-set means another request consumed this candidate.
  // Read the next one immediately instead of delaying it until another poll.
  while (!claimed) {
    const now = new Date()
    const [candidate] = await db
      .select()
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
    if (!candidate) return null
    const payload =
      candidate.type === 'backup' ? parseBackupPayload(candidate.payload) : null
    claimed = await claimBackupCandidate(db, {
      job: candidate,
      backupRunId: payload?.backupRunId ?? null,
      now,
    })
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
    await failStaleRunningDeployments(serverId)
  }

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

export async function failStaleRunningDeployments(serverId?: string) {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const staleRows = await db
    .select({ id: deployments.id, serverId: deployments.serverId })
    .from(deployments)
    .where(
      and(
        serverId ? eq(deployments.serverId, serverId) : undefined,
        eq(deployments.status, 'running'),
        lt(deployments.startedAt, cutoff),
      ),
    )
  const staleIds = staleRows.map((row) => row.id)

  if (staleIds.length === 0) {
    return []
  }

  const failed = await failRunningDeployments(db, {
    ids: staleIds,
    message: 'Deployment timed out after the agent stopped reporting.',
    phase: 'timed_out',
    startedBefore: cutoff,
    now: new Date(),
  })
  const failedIds = new Set(failed)
  const affectedServers = new Set(
    staleRows.filter((row) => failedIds.has(row.id)).map((row) => row.serverId),
  )
  await Promise.all(
    [...affectedServers].map((id) => notifyServer(id, 'deployments')),
  )
  return failed
}

async function failStaleRunningAgentJobsForServer(serverId: string) {
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

  const failed: Array<{ id: string }> = []
  for (const { job } of stale) {
    const backup =
      job.type === 'backup' ? parseBackupPayload(job.payload) : null
    const cleanup =
      job.type === 'backup_cleanup'
        ? parseBackupCleanupPayload(job.payload)
        : null
    if (
      await failStaleAgentJob(db, {
        job,
        now,
        timeoutMs:
          job.type === 'backup' ||
          job.type === 'backup_cleanup' ||
          job.type === 'restore'
            ? 25 * 60 * 60 * 1000
            : 3 * 60 * 60 * 1000,
        message: 'Agent job timed out before completion was reported.',
        backupRunId: backup?.backupRunId ?? null,
        cleanupRunIds: cleanup?.backupRunIds ?? [],
      })
    )
      failed.push({ id: job.id })
  }
  if (failed.length > 0) await notifyServer(serverId, 'deployments')
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
    // The queued revision is canonical; display abbreviations from older agents
    // must never replace a fetchable full commit ID.
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
