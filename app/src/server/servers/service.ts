import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { and, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'

import { reconcileReportedRuntimes } from '@/server/agents/reconciliation'
import type { ReportedRuntime } from '@/server/agents/reconciliation'
import { getAgentUpdate } from '@/server/agents/compatibility'
import type { AgentUpdate } from '@/server/agents/compatibility'
import { AgentRequestError } from '@/server/agents/protocol'
import { config, currentAgentVersion } from '@/server/config'
import { db } from '@/server/db'
import {
  agentJobs,
  backupRuns,
  deployments,
  environments,
  projects,
  serverAvailabilityWindows,
  serverHeartbeats,
  serverMetrics,
  servers,
} from '@/server/db/schema'
import {
  listServerMetricSeries,
  listServerMonitoringSummaries,
  recordServerHeartbeat,
  recordServerMetrics,
} from '@/server/servers/monitoring'
import type {
  ServerMetricsInput,
  ServerMetricsSample,
  ServerMonitoringSummary,
} from '@/server/servers/monitoring'
import { requireTeam, requireTeamManager } from '@/server/teams/service'
import { getEffectiveServerStatus } from '@/server/servers/status'
import type { ServerStatus } from '@/server/servers/status'

export type CreatedServer = {
  id: string
  name: string
  status: 'pending'
  installCommand: string
}

export type ServerInstallCommand = {
  serverId: string
  installCommand: string
}

export type ServerDetail = {
  id: string
  name: string
  status: ServerStatus
  agentVersion: string | null
  agentProtocolVersion: number | null
  agentCapabilities: Array<string> | null
  agentUpdate: AgentUpdate
  publicAddress: string | null
  lastSeenAt: string | null
  hostname: string | null
  operatingSystem: string | null
  kernelVersion: string | null
  architecture: string | null
  cpuCoreCount: number | null
  hostUptimeSeconds: number | null
  monitoring: ServerMonitoringSummary
  metricSeries: Array<ServerMetricsSample>
  metricWindow: {
    startedAt: string
    endedAt: string
  }
  createdAt: string
  updatedAt: string
}

export type ServerDeleteDiagnostic = {
  serverId: string
  serverName: string
  projectCount: number
  environmentCount: number
}

const serverMachineNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/
const serverMachineNameError =
  'Server names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.'

export type AgentRegistration = {
  serverId: string
  status: 'connected'
  credential?: string
  runtimeLogTargets?: Array<{
    runtimeId: string
  }>
}

export type HostDetailsInput = {
  hostname?: string
  operatingSystem?: string
  kernelVersion?: string
  architecture?: string
  cpuCoreCount?: number
  uptimeSeconds?: number
}

export async function requireTeamServer({
  userId,
  teamSlug,
  serverId,
}: {
  userId: string
  teamSlug: string
  serverId: string
}): Promise<ServerDetail> {
  const team = await requireTeam(userId, teamSlug)
  const rows = await db
    .select({
      id: servers.id,
      name: servers.name,
      status: servers.status,
      agentVersion: servers.agentVersion,
      agentProtocolVersion: servers.agentProtocolVersion,
      agentCapabilities: servers.agentCapabilities,
      publicAddress: servers.publicAddress,
      lastSeenAt: servers.lastSeenAt,
      hostname: servers.hostname,
      operatingSystem: servers.operatingSystem,
      kernelVersion: servers.kernelVersion,
      architecture: servers.architecture,
      cpuCoreCount: servers.cpuCoreCount,
      hostUptimeSeconds: servers.hostUptimeSeconds,
      createdAt: servers.createdAt,
      updatedAt: servers.updatedAt,
    })
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.teamId, team.id),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)
  const server = rows.at(0)

  if (!server) {
    throw new Error('Server not found.')
  }

  const now = new Date()
  const metricWindowStart = new Date(
    Math.max(server.createdAt.getTime(), now.getTime() - 24 * 60 * 60 * 1000),
  )
  const monitoring = await listServerMonitoringSummaries(
    [
      {
        id: server.id,
        createdAt: server.createdAt,
        status: server.status,
      },
    ],
    now,
  )
  const metricSeries = await listServerMetricSeries({
    serverId: server.id,
    now,
    startAt: metricWindowStart,
  })

  return {
    ...server,
    status: getEffectiveServerStatus({
      status: server.status,
      lastSeenAt: server.lastSeenAt,
      now,
    }),
    agentUpdate: server.lastSeenAt
      ? getAgentUpdate({
          agentVersion: server.agentVersion,
          protocolVersion: server.agentProtocolVersion,
          capabilities: server.agentCapabilities,
          latestVersion: currentAgentVersion,
          recommendedVersion: config.DEVPUSH_RECOMMENDED_AGENT_VERSION ?? null,
        })
      : { status: 'current', latestVersion: null, reason: null },
    lastSeenAt: server.lastSeenAt?.toISOString() ?? null,
    monitoring: monitoring.get(server.id) ?? {
      availabilityPercent: null,
      availabilityWindowMs: 0,
      latestMetrics: null,
    },
    metricSeries,
    metricWindow: {
      startedAt: metricWindowStart.toISOString(),
      endedAt: now.toISOString(),
    },
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
  }
}

export async function updateTeamServer({
  userId,
  teamSlug,
  serverId,
  name,
}: {
  userId: string
  teamSlug: string
  serverId: string
  name: string
}) {
  const nextName = name.trim()
  validateServerMachineName(nextName)
  const team = await requireTeamManager(userId, teamSlug)
  const existingRows = await db
    .select({ id: servers.id })
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.teamId, team.id),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)

  if (!existingRows.at(0)) {
    throw new Error('Server not found.')
  }

  const duplicateRows = await db
    .select({ id: servers.id })
    .from(servers)
    .where(
      and(
        eq(servers.teamId, team.id),
        sql`lower(${servers.handle}) = lower(${nextName})`,
        ne(servers.id, serverId),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)

  if (duplicateRows.at(0)) {
    throw new Error('Server names must be unique within a team.')
  }

  await db
    .update(servers)
    .set({ name: nextName, handle: nextName, updatedAt: new Date() })
    .where(eq(servers.id, serverId))
}

export async function disableTeamServer({
  confirmationName,
  userId,
  teamSlug,
  serverId,
}: {
  confirmationName: string
  userId: string
  teamSlug: string
  serverId: string
}) {
  const team = await requireTeamManager(userId, teamSlug)
  const existingRows = await db
    .select({ id: servers.id, name: servers.name })
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.teamId, team.id),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)

  const server = existingRows.at(0)

  if (!server) {
    throw new Error('Server not found.')
  }

  if (confirmationName !== server.name) {
    throw new Error('Type the server name to confirm disabling.')
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(servers)
      .set({
        status: 'disabled',
        enrollmentTokenHash: null,
        enrollmentTokenExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(servers.id, serverId))
    await tx
      .update(serverAvailabilityWindows)
      .set({ endedAt: now })
      .where(
        and(
          eq(serverAvailabilityWindows.serverId, serverId),
          isNull(serverAvailabilityWindows.endedAt),
        ),
      )
  })
}

export async function enableTeamServer({
  userId,
  teamSlug,
  serverId,
}: {
  userId: string
  teamSlug: string
  serverId: string
}) {
  const team = await requireTeamManager(userId, teamSlug)
  const existingRows = await db
    .select({ id: servers.id, status: servers.status })
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.teamId, team.id),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)

  const server = existingRows.at(0)
  if (!server) {
    throw new Error('Server not found.')
  }

  if (server.status !== 'disabled') {
    throw new Error('Only disabled servers can be enabled.')
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(servers)
      .set({
        status: 'pending',
        updatedAt: now,
      })
      .where(eq(servers.id, serverId))
    await tx.insert(serverAvailabilityWindows).values({
      id: randomUUID(),
      serverId,
      startedAt: now,
    })
  })
}

export async function createPendingServer({
  userId,
  teamSlug,
  name,
}: {
  userId: string
  teamSlug: string
  name: string
}): Promise<CreatedServer> {
  const nextName = name.trim()
  validateServerMachineName(nextName)
  const team = await requireTeamManager(userId, teamSlug)
  const duplicateRows = await db
    .select({ id: servers.id })
    .from(servers)
    .where(
      and(
        eq(servers.teamId, team.id),
        sql`lower(${servers.handle}) = lower(${nextName})`,
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)

  if (duplicateRows.at(0)) {
    throw new Error('Server names must be unique within a team.')
  }

  const serverId = randomUUID()
  const enrollmentToken = `dps_${randomBytes(32).toString('base64url')}`
  const enrollmentTokenHash = hashToken(enrollmentToken)
  const enrollmentTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000)

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(servers).values({
      id: serverId,
      teamId: team.id,
      name: nextName,
      handle: nextName,
      status: 'pending',
      enrollmentTokenHash,
      enrollmentTokenExpiresAt,
      createdAt: now,
      updatedAt: now,
    })
    await tx.insert(serverAvailabilityWindows).values({
      id: randomUUID(),
      serverId,
      startedAt: now,
    })
  })

  return {
    id: serverId,
    name: nextName,
    status: 'pending',
    installCommand: buildInstallCommand({
      baseUrl: config.DEVPUSH_BASE_URL,
      token: enrollmentToken,
    }),
  }
}

export async function createServerInstallCommand({
  userId,
  teamSlug,
  serverId,
}: {
  userId: string
  teamSlug: string
  serverId: string
}): Promise<ServerInstallCommand> {
  const team = await requireTeamManager(userId, teamSlug)
  const serverRows = await db
    .select({
      id: servers.id,
      status: servers.status,
      lastSeenAt: servers.lastSeenAt,
    })
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.teamId, team.id),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)
  const server = serverRows.at(0)

  if (!server) {
    throw new Error('Server not found.')
  }

  if (server.status === 'disabled') {
    throw new Error('Disabled servers cannot be enrolled.')
  }

  if (server.status === 'deleted') {
    throw new Error('Deleted servers cannot be enrolled.')
  }

  if (
    getEffectiveServerStatus({
      status: server.status,
      lastSeenAt: server.lastSeenAt,
    }) === 'connected'
  ) {
    throw new Error(
      'Connected servers cannot be re-enrolled. Disable the server first.',
    )
  }

  const enrollmentToken = `dps_${randomBytes(32).toString('base64url')}`
  const enrollmentTokenHash = hashToken(enrollmentToken)
  const enrollmentTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000)
  const now = new Date()

  await db
    .update(servers)
    .set({
      enrollmentTokenHash,
      enrollmentTokenExpiresAt,
      updatedAt: now,
    })
    .where(eq(servers.id, server.id))

  return {
    serverId: server.id,
    installCommand: buildInstallCommand({
      baseUrl: config.DEVPUSH_BASE_URL,
      token: enrollmentToken,
    }),
  }
}

export async function registerAgent({
  token,
  agentVersion,
  protocolVersion,
  capabilities,
  publicAddress,
}: {
  token: string
  agentVersion?: string | null
  protocolVersion?: number
  capabilities?: Array<string>
  publicAddress: string | null
}): Promise<AgentRegistration> {
  const auth = await findServerForCredential(token)
  const server = auth.server

  if (server.status === 'deleted') {
    throw new AgentRequestError(403, 'Server was deleted.')
  }

  const now = new Date()
  const credential =
    auth.credentialType === 'enrollment'
      ? `dpa_${randomBytes(32).toString('base64url')}`
      : undefined
  const updates = {
    status: 'connected' as const,
    ...(agentVersion ? { agentVersion } : {}),
    ...(protocolVersion ? { agentProtocolVersion: protocolVersion } : {}),
    ...(capabilities ? { agentCapabilities: capabilities } : {}),
    ...(publicAddress ? { publicAddress } : {}),
    lastSeenAt: now,
    ...(credential
      ? { pendingAgentCredentialHash: hashToken(credential) }
      : {}),
    updatedAt: now,
  }

  await db.update(servers).set(updates).where(eq(servers.id, server.id))
  await recordServerHeartbeat({
    serverId: server.id,
    observedAt: now,
    agentVersion: agentVersion ?? null,
    publicAddress,
  })

  return {
    serverId: server.id,
    status: 'connected',
    ...(credential ? { credential } : {}),
  }
}

export async function recordAgentHeartbeat({
  serverId,
  token,
  agentVersion,
  protocolVersion,
  capabilities,
  publicAddress,
  runtimeIds,
  runtimes,
  system,
  metrics,
}: {
  serverId: string
  token: string
  agentVersion?: string | null
  protocolVersion?: number
  capabilities?: Array<string>
  publicAddress: string | null
  runtimeIds?: Array<string>
  runtimes?: Array<ReportedRuntime>
  system?: HostDetailsInput
  metrics?: ServerMetricsInput
}): Promise<AgentRegistration> {
  const auth = await requireAgentCredential(token)
  const server = auth.server

  if (server.id !== serverId) {
    throw new AgentRequestError(401, 'Agent token does not match this server.')
  }

  const now = new Date()
  if (server.status !== 'deleted') {
    if (auth.credentialType === 'pending') {
      await db
        .update(servers)
        .set({
          agentCredentialHash: server.pendingAgentCredentialHash,
          pendingAgentCredentialHash: null,
          enrollmentTokenHash: null,
          enrollmentTokenExpiresAt: null,
          agentCredentialRotatedAt: now,
          updatedAt: now,
        })
        .where(eq(servers.id, server.id))
    }

    const updates = {
      status: 'connected' as const,
      ...(agentVersion ? { agentVersion } : {}),
      ...(protocolVersion ? { agentProtocolVersion: protocolVersion } : {}),
      ...(capabilities ? { agentCapabilities: capabilities } : {}),
      ...(publicAddress ? { publicAddress } : {}),
      ...(system?.hostname ? { hostname: system.hostname } : {}),
      ...(system?.operatingSystem
        ? { operatingSystem: system.operatingSystem }
        : {}),
      ...(system?.kernelVersion ? { kernelVersion: system.kernelVersion } : {}),
      ...(system?.architecture ? { architecture: system.architecture } : {}),
      ...(system?.cpuCoreCount ? { cpuCoreCount: system.cpuCoreCount } : {}),
      ...(system?.uptimeSeconds !== undefined
        ? { hostUptimeSeconds: system.uptimeSeconds }
        : {}),
      lastSeenAt: now,
      updatedAt: now,
    }

    await db.update(servers).set(updates).where(eq(servers.id, server.id))
    await recordServerHeartbeat({
      serverId: server.id,
      observedAt: now,
      agentVersion: agentVersion ?? null,
      publicAddress,
    })
    if (metrics) {
      await recordServerMetrics({
        serverId: server.id,
        observedAt: now,
        metrics,
      })
    }
  }

  const observedRuntimeIds =
    runtimeIds ?? runtimes?.map((runtime) => runtime.runtimeId)
  if (observedRuntimeIds && server.status !== 'deleted') {
    await reconcileReportedRuntimes({
      serverId: server.id,
      runtimeIds: observedRuntimeIds,
      runtimes,
    })
  }

  return {
    serverId: server.id,
    status: 'connected',
    runtimeLogTargets:
      server.status === 'deleted' ? [] : await listRuntimeLogTargets(server.id),
  }
}

export async function rotateAgentCredential({
  serverId,
  token,
}: {
  serverId: string
  token: string
}): Promise<AgentRegistration> {
  const auth = await requireAgentCredential(token)
  const server = auth.server

  if (server.id !== serverId) {
    throw new AgentRequestError(
      401,
      'Agent credential does not match this server.',
    )
  }
  if (server.status === 'deleted') {
    throw new AgentRequestError(403, 'Server was deleted.')
  }
  if (auth.credentialType === 'pending') {
    await db
      .update(servers)
      .set({
        agentCredentialHash: server.pendingAgentCredentialHash,
        pendingAgentCredentialHash: null,
        enrollmentTokenHash: null,
        agentCredentialRotatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(servers.id, server.id))
  }

  const credential = `dpa_${randomBytes(32).toString('base64url')}`
  await db
    .update(servers)
    .set({
      pendingAgentCredentialHash: hashToken(credential),
      updatedAt: new Date(),
    })
    .where(eq(servers.id, server.id))

  return { serverId: server.id, status: 'connected', credential }
}

export async function getServerDeleteDiagnostic({
  userId,
  teamSlug,
  serverId,
}: {
  userId: string
  teamSlug: string
  serverId: string
}): Promise<ServerDeleteDiagnostic> {
  const team = await requireTeamManager(userId, teamSlug)
  const serverRows = await db
    .select({
      id: servers.id,
      name: servers.name,
    })
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.teamId, team.id),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)
  const server = serverRows.at(0)

  if (!server) {
    throw new Error('Server not found.')
  }

  const assignmentRows = await db
    .select({
      projectCount: sql<number>`count(distinct ${projects.id})`,
      environmentCount: sql<number>`count(*)`,
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(
        eq(
          sql`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
          server.id,
        ),
        eq(environments.status, 'active'),
        eq(projects.teamId, team.id),
        eq(projects.status, 'active'),
      ),
    )
  const assignments = assignmentRows.at(0)

  return {
    serverId: server.id,
    serverName: server.name,
    projectCount: Number(assignments?.projectCount ?? 0),
    environmentCount: Number(assignments?.environmentCount ?? 0),
  }
}

export async function deleteTeamServer({
  cancelOngoingDeployments,
  confirmationName,
  userId,
  teamSlug,
  serverId,
}: {
  cancelOngoingDeployments: boolean
  confirmationName: string
  userId: string
  teamSlug: string
  serverId: string
}) {
  const team = await requireTeamManager(userId, teamSlug)
  const serverRows = await db
    .select({
      id: servers.id,
      name: servers.name,
    })
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.teamId, team.id),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)
  const server = serverRows.at(0)

  if (!server) {
    throw new Error('Server not found.')
  }

  if (confirmationName !== server.name) {
    throw new Error('Type the server name to confirm deletion.')
  }

  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(agentJobs)
      .set({
        status: 'canceled',
        errorMessage: 'Canceled because the server was deleted.',
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentJobs.serverId, server.id),
          inArray(agentJobs.type, ['backup', 'restore', 'backup_cleanup']),
          inArray(agentJobs.status, ['queued', 'running']),
        ),
      )
    await tx
      .update(backupRuns)
      .set({
        status: 'canceled',
        errorMessage: 'Canceled because the server was deleted.',
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(backupRuns.serverId, server.id),
          inArray(backupRuns.status, ['queued', 'running']),
        ),
      )

    if (cancelOngoingDeployments) {
      await tx
        .update(deployments)
        .set({
          status: 'canceled',
          phase: 'canceled',
          errorMessage: 'Canceled because the server was deleted.',
          finishedAt: now,
        })
        .where(
          and(
            eq(deployments.serverId, server.id),
            inArray(deployments.status, ['queued', 'running']),
          ),
        )

      await tx
        .update(agentJobs)
        .set({
          status: 'canceled',
          errorMessage: 'Canceled because the server was deleted.',
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(agentJobs.serverId, server.id),
            eq(agentJobs.type, 'deploy'),
            inArray(agentJobs.status, ['queued', 'running']),
          ),
        )
    }

    await tx.delete(serverMetrics).where(eq(serverMetrics.serverId, server.id))
    await tx
      .delete(serverHeartbeats)
      .where(eq(serverHeartbeats.serverId, server.id))
    await tx
      .update(serverAvailabilityWindows)
      .set({ endedAt: now })
      .where(
        and(
          eq(serverAvailabilityWindows.serverId, server.id),
          isNull(serverAvailabilityWindows.endedAt),
        ),
      )
    await tx
      .update(servers)
      .set({
        status: 'deleted',
        ...(cancelOngoingDeployments
          ? {
              enrollmentTokenHash: null,
              enrollmentTokenExpiresAt: null,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(servers.id, server.id))
  })
}

export async function requireAgentServer({
  cleanupJobId,
  serverId,
  token,
}: {
  cleanupJobId?: string
  serverId: string
  token: string
}) {
  const { server } = await requireAgentCredential(token, { cleanupJobId })

  if (server.id !== serverId) {
    throw new AgentRequestError(401, 'Agent token does not match this server.')
  }

  return server
}

async function listRuntimeLogTargets(serverId: string) {
  const rows = await db
    .select({ runtimeId: environments.runtimeId })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(
        eq(
          sql`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
          serverId,
        ),
        eq(environments.status, 'active'),
        eq(projects.status, 'active'),
      ),
    )

  return Array.from(new Set(rows.map((row) => row.runtimeId)))
    .sort()
    .map((runtimeId) => ({ runtimeId }))
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function validateServerMachineName(name: string) {
  if (
    name.length === 0 ||
    name.length > 100 ||
    !serverMachineNamePattern.test(name)
  ) {
    throw new Error(serverMachineNameError)
  }
}

async function findServerForCredential(token: string) {
  const tokenHash = hashToken(token)
  const rows = await db
    .select({
      id: servers.id,
      status: servers.status,
      enrollmentTokenHash: servers.enrollmentTokenHash,
      enrollmentTokenExpiresAt: servers.enrollmentTokenExpiresAt,
      agentCredentialHash: servers.agentCredentialHash,
      pendingAgentCredentialHash: servers.pendingAgentCredentialHash,
    })
    .from(servers)
    .where(
      or(
        and(
          eq(servers.enrollmentTokenHash, tokenHash),
          gt(servers.enrollmentTokenExpiresAt, new Date()),
        ),
        eq(servers.agentCredentialHash, tokenHash),
        eq(servers.pendingAgentCredentialHash, tokenHash),
      ),
    )
    .limit(1)
  const server = rows.at(0)

  if (!server) {
    throw new AgentRequestError(401, 'Invalid or expired agent credential.')
  }

  if (server.status === 'disabled') {
    throw new AgentRequestError(403, 'Server is disabled.')
  }

  return {
    server,
    credentialType:
      server.enrollmentTokenHash === tokenHash
        ? ('enrollment' as const)
        : server.pendingAgentCredentialHash === tokenHash
          ? ('pending' as const)
          : ('active' as const),
  }
}

async function requireAgentCredential(
  token: string,
  { cleanupJobId }: { cleanupJobId?: string } = {},
) {
  const auth = await findServerForCredential(token)

  if (auth.credentialType === 'enrollment') {
    throw new AgentRequestError(
      401,
      'Enrollment tokens cannot authenticate agent requests.',
    )
  }

  if (auth.server.status === 'deleted') {
    await recoverStaleDeletedServerCleanupJobs(auth.server.id, cleanupJobId)

    if (!(await hasPermittedDeletedServerWork(auth.server.id))) {
      throw new AgentRequestError(403, 'Server was deleted.')
    }
  }

  return auth
}

async function recoverStaleDeletedServerCleanupJobs(
  serverId: string,
  cleanupJobId?: string,
) {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000)
  const staleJobFilter = and(
    eq(agentJobs.serverId, serverId),
    inArray(agentJobs.type, ['deprovision', 'purge']),
    eq(agentJobs.status, 'running'),
    lt(agentJobs.claimedAt, cutoff),
    ...(cleanupJobId ? [ne(agentJobs.id, cleanupJobId)] : []),
  )

  await db.transaction(async (tx) => {
    await tx
      .update(agentJobs)
      .set({
        status: 'abandoned',
        errorMessage: 'Cleanup stopped reporting after its final attempt.',
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          staleJobFilter,
          sql`${agentJobs.attempt} >= ${agentJobs.maxAttempts}`,
        ),
      )
    await tx
      .update(agentJobs)
      .set({
        status: 'queued',
        errorMessage: 'Cleanup stopped reporting and will be retried.',
        claimedAt: null,
        availableAt: now,
        finishedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          staleJobFilter,
          sql`${agentJobs.attempt} < ${agentJobs.maxAttempts}`,
        ),
      )
  })
}

async function hasPermittedDeletedServerWork(serverId: string) {
  const [deploymentRows, jobRows] = await Promise.all([
    db
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.serverId, serverId),
          inArray(deployments.status, ['queued', 'running']),
        ),
      )
      .limit(1),
    db
      .select({ id: agentJobs.id })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.serverId, serverId),
          inArray(agentJobs.type, ['deprovision', 'purge']),
          inArray(agentJobs.status, ['queued', 'running']),
        ),
      )
      .limit(1),
  ])

  return deploymentRows.length > 0 || jobRows.length > 0
}

function buildInstallCommand({
  baseUrl,
  token,
}: {
  baseUrl: string
  token: string
}) {
  const installUrl = `${baseUrl.replace(/\/$/, '')}/api/install/agent`
  const tokenInstallUrl = `${installUrl}/${encodeURIComponent(token)}`

  return `tmp="$(mktemp)" && curl -fsSL ${shellQuote(tokenInstallUrl)} -o "$tmp" && sudo bash "$tmp"; status=$?; test -z "\${tmp:-}" || rm -f "$tmp"; exit "$status"`
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
