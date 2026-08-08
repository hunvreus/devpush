import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import { reconcileReportedRuntimes } from '@/server/agents/reconciliation'
import type { ReportedRuntime } from '@/server/agents/reconciliation'
import { config } from '@/server/config'
import { db } from '@/server/db'
import {
  agentJobs,
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
import { requireTeam } from '@/server/teams/service'
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
  const team = await requireTeam(userId, teamSlug)
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
  const team = await requireTeam(userId, teamSlug)
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
  const team = await requireTeam(userId, teamSlug)
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
  const team = await requireTeam(userId, teamSlug)
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
      serverUrl: config.BETTER_AUTH_URL,
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
  const team = await requireTeam(userId, teamSlug)
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
      serverUrl: config.BETTER_AUTH_URL,
      token: enrollmentToken,
    }),
  }
}

export async function registerAgent({
  token,
  agentVersion,
  publicAddress,
}: {
  token: string
  agentVersion: string | null
  publicAddress: string | null
}): Promise<AgentRegistration> {
  const auth = await findServerForRegistrationToken(token)
  const server = auth.server

  if (server.status === 'deleted') {
    throw new Error('Server was deleted.')
  }

  const now = new Date()
  const credential =
    auth.kind === 'enrollment'
      ? `dpa_${randomBytes(32).toString('base64url')}`
      : undefined
  const updates = {
    status: 'connected' as const,
    agentVersion,
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
    agentVersion,
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
  publicAddress,
  runtimeIds,
  runtimes,
  system,
  metrics,
}: {
  serverId: string
  token: string
  agentVersion: string | null
  publicAddress: string | null
  runtimeIds?: Array<string>
  runtimes?: Array<ReportedRuntime>
  system?: HostDetailsInput
  metrics?: ServerMetricsInput
}): Promise<AgentRegistration> {
  const auth = await requireAgentCredential(token)
  const server = auth.server

  if (server.id !== serverId) {
    throw new Error('Agent token does not match this server.')
  }

  const now = new Date()
  if (server.status !== 'deleted') {
    if (auth.kind === 'pending') {
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
      agentVersion,
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
      agentVersion,
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
    throw new Error('Agent credential does not match this server.')
  }
  if (server.status === 'deleted') {
    throw new Error('Server was deleted.')
  }
  if (auth.kind === 'pending') {
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
  const team = await requireTeam(userId, teamSlug)
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
        eq(environments.serverId, server.id),
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
  const team = await requireTeam(userId, teamSlug)
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
  serverId,
  token,
}: {
  serverId: string
  token: string
}) {
  const { server } = await requireAgentCredential(token)

  if (server.id !== serverId) {
    throw new Error('Agent token does not match this server.')
  }

  return server
}

async function listRuntimeLogTargets(serverId: string) {
  const rows = await db
    .select({ runtimeId: environments.runtimeId })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(eq(environments.serverId, serverId), eq(projects.status, 'active')),
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

async function findServerForRegistrationToken(token: string) {
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
        and(
          eq(servers.enrollmentTokenHash, tokenHash),
          isNull(servers.enrollmentTokenExpiresAt),
          inArray(servers.status, ['connected', 'disconnected']),
        ),
        eq(servers.agentCredentialHash, tokenHash),
        eq(servers.pendingAgentCredentialHash, tokenHash),
      ),
    )
    .limit(1)
  const server = rows.at(0)

  if (!server) {
    throw new Error('Invalid or expired agent credential.')
  }

  if (server.status === 'disabled') {
    throw new Error('Server is disabled.')
  }

  return {
    server,
    kind:
      server.enrollmentTokenHash === tokenHash
        ? server.enrollmentTokenExpiresAt
          ? ('enrollment' as const)
          : ('legacy' as const)
        : server.pendingAgentCredentialHash === tokenHash
          ? ('pending' as const)
          : ('active' as const),
  }
}

async function requireAgentCredential(token: string) {
  const auth = await findServerForRegistrationToken(token)

  if (auth.kind === 'enrollment') {
    throw new Error('Enrollment tokens cannot authenticate agent requests.')
  }

  if (auth.kind === 'legacy') {
    await db
      .update(servers)
      .set({
        agentCredentialHash: auth.server.enrollmentTokenHash,
        enrollmentTokenHash: null,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, auth.server.id))
  }

  return auth
}

function buildInstallCommand({
  serverUrl,
  token,
}: {
  serverUrl: string
  token: string
}) {
  const installUrl = `${serverUrl.replace(/\/$/, '')}/api/install/agent`
  const tokenInstallUrl = `${installUrl}/${encodeURIComponent(token)}`

  return `tmp="$(mktemp)" && curl -fsSL ${shellQuote(tokenInstallUrl)} -o "$tmp" && sudo bash "$tmp"; status=$?; test -z "\${tmp:-}" || rm -f "$tmp"; exit "$status"`
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
