import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import { reconcileReportedRuntimes } from '@/server/agents/reconciliation'
import { config } from '@/server/config'
import { db } from '@/server/db'
import {
  agentJobs,
  deployments,
  environments,
  projectServers,
  projects,
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
  monitoring: ServerMonitoringSummary
  metricSeries: Array<ServerMetricsSample>
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
  runtimeLogTargets?: Array<{
    runtimeId: string
  }>
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
  const monitoring = await listServerMonitoringSummaries(
    [{ id: server.id, createdAt: server.createdAt }],
    now,
  )
  const metricSeries = await listServerMetricSeries({
    serverId: server.id,
    now,
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
      heartbeatCount24h: 0,
      uptime24h: null,
      latestMetrics: null,
    },
    metricSeries,
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

  await db
    .update(servers)
    .set({
      status: 'disabled',
      enrollmentTokenHash: null,
      enrollmentTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(servers.id, serverId))
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

  await db
    .update(servers)
    .set({
      status: 'pending',
      updatedAt: new Date(),
    })
    .where(eq(servers.id, serverId))
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

  await db.insert(servers).values({
    id: serverId,
    teamId: team.id,
    name: nextName,
    handle: nextName,
    status: 'pending',
    enrollmentTokenHash,
    enrollmentTokenExpiresAt,
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
  const server = await requireServerForToken(token)

  if (server.status === 'deleted') {
    throw new Error('Server was deleted.')
  }

  const now = new Date()
  const updates = {
    status: 'connected' as const,
    agentVersion,
    ...(publicAddress ? { publicAddress } : {}),
    lastSeenAt: now,
    enrollmentTokenExpiresAt: null,
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
  }
}

export async function recordAgentHeartbeat({
  serverId,
  token,
  agentVersion,
  publicAddress,
  runtimeIds,
  metrics,
}: {
  serverId: string
  token: string
  agentVersion: string | null
  publicAddress: string | null
  runtimeIds?: Array<string>
  metrics?: ServerMetricsInput
}): Promise<AgentRegistration> {
  const server = await requireServerForToken(token)

  if (server.id !== serverId) {
    throw new Error('Agent token does not match this server.')
  }

  const now = new Date()
  if (server.status !== 'deleted') {
    const updates = {
      status: 'connected' as const,
      agentVersion,
      ...(publicAddress ? { publicAddress } : {}),
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

  if (runtimeIds && server.status !== 'deleted') {
    await reconcileReportedRuntimes({ serverId: server.id, runtimeIds })
  }

  return {
    serverId: server.id,
    status: 'connected',
    runtimeLogTargets:
      server.status === 'deleted' ? [] : await listRuntimeLogTargets(server.id),
  }
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
    .from(projectServers)
    .innerJoin(projects, eq(projects.id, projectServers.projectId))
    .where(
      and(
        eq(projectServers.serverId, server.id),
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
  const server = await requireServerForToken(token)

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

async function requireServerForToken(token: string) {
  const tokenHash = hashToken(token)
  const rows = await db
    .select({
      id: servers.id,
      status: servers.status,
    })
    .from(servers)
    .where(
      and(
        eq(servers.enrollmentTokenHash, tokenHash),
        or(
          isNull(servers.enrollmentTokenExpiresAt),
          gt(servers.enrollmentTokenExpiresAt, new Date()),
        ),
      ),
    )
    .limit(1)
  const server = rows.at(0)

  if (!server) {
    throw new Error('Invalid or expired agent token.')
  }

  if (server.status === 'disabled') {
    throw new Error('Server is disabled.')
  }

  return server
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
