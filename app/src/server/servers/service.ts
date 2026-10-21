import { withWorkspaceAccess } from '@/deployment/workspace-access'
import { deploymentContext } from '@/deployment/server-context'
import { getDeploymentServices } from '@/deployment/services.server'
import { recoverStaleCleanupJobs } from '@/server/agents/container-cleanup-state'
import { teamSettingsAccess } from '@/server/settings-version'
import { PublicError } from '@/lib/public-error'
import { recordAgentMetricSamples } from './metric-history'
import type { AgentMetricSample } from './metric-history-schema'
import { deleteServerState, changeServerEnabled } from './lifecycle'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { and, eq, gt, inArray, ne, or, sql } from 'drizzle-orm'

import { reconcileReportedRuntimes } from '@/server/agents/reconciliation'
import type { ReportedRuntime } from '@/server/agents/reconciliation'
import { getAgentUpdate } from '@/server/agents/compatibility'
import type { AgentUpdate } from '@/server/agents/compatibility'
import { AgentRequestError } from '@/server/agents/protocol'
import { config, currentAgentVersion } from '@/server/config'
import { db } from '@/server/db'
import {
  agentJobs,
  deployments,
  environments,
  projects,
  serverAvailabilityWindows,
  servers,
} from '@/server/db/schema'
import {
  listServerMetricSeries,
  downsampleServerMetricSeries,
  listServerMonitoringSummaries,
  recordServerHeartbeat,
} from '@/server/servers/monitoring'
import type { ServerMonitoringSummary } from '@/server/servers/monitoring'
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
  settingsVersion: number
  id: string
  name: string
  status: ServerStatus
  agentVersion: string | null
  agentProtocolVersion: number | null
  agentCapabilities: Array<string> | null
  agentUpdate: AgentUpdate
  publicAddress: string | null
  publicIpv4?: string | null
  publicIpv6?: string | null
  lastSeenAt: string | null
  hostname: string | null
  operatingSystem: string | null
  kernelVersion: string | null
  architecture: string | null
  cpuCoreCount: number | null
  hostUptimeSeconds: number | null
  monitoring: ServerMonitoringSummary
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

export type AgentRegistration = {
  managedCertificates?: boolean
  metricsAcceptedThrough?: string
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
  return requireServerForTeam({ teamId: team.id, serverId })
}

export async function requireServerForTeam({
  teamId,
  serverId,
}: {
  teamId: string
  serverId: string
}): Promise<ServerDetail> {
  const rows = await db
    .select({
      settingsVersion: servers.settingsVersion,
      id: servers.id,
      name: servers.name,
      status: servers.status,
      agentVersion: servers.agentVersion,
      agentProtocolVersion: servers.agentProtocolVersion,
      agentCapabilities: servers.agentCapabilities,
      publicAddress: servers.publicAddress,
      publicIpv4: servers.publicIpv4,
      publicIpv6: servers.publicIpv6,
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
        eq(servers.teamId, teamId),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)
  const server = rows.at(0)

  if (!server) {
    throw new PublicError('SERVER_NOT_FOUND')
  }

  const now = new Date()
  const monitoring = await listServerMonitoringSummaries(
    [{ id: server.id, createdAt: server.createdAt, status: server.status }],
    now,
  )

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
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
  }
}

export async function requireServerMetricHistoryForTeam({
  teamId,
  serverId,
}: {
  teamId: string
  serverId: string
}) {
  const [server] = await db
    .select({ createdAt: servers.createdAt })
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.teamId, teamId),
        ne(servers.status, 'deleted'),
      ),
    )
    .limit(1)
  if (!server) throw new PublicError('SERVER_NOT_FOUND')
  const now = new Date()
  const startAt = new Date(
    Math.max(server.createdAt.getTime(), now.getTime() - 24 * 60 * 60 * 1000),
  )
  return {
    points: downsampleServerMetricSeries(
      await listServerMetricSeries({ serverId, now, startAt }),
    ),
    window: { startedAt: startAt.toISOString(), endedAt: now.toISOString() },
  }
}

export async function updateTeamServer({
  settingsVersion,
  userId,
  teamSlug,
  serverId,
  name,
}: {
  settingsVersion?: number
  userId: string
  teamSlug: string
  serverId: string
  name: string
}) {
  const nextName = name.trim()
  validateServerMachineName(nextName)
  const team = await requireTeamManager(userId, teamSlug)
  const existingRows = await db
    .select({ id: servers.id, settingsVersion: servers.settingsVersion })
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
    throw new PublicError('SERVER_NOT_FOUND')
  }

  const expectedVersion = settingsVersion ?? existingRows[0]!.settingsVersion
  if (expectedVersion !== existingRows[0]!.settingsVersion)
    throw new PublicError('SETTINGS_CONFLICT')

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
    throw new PublicError('SERVER_NAME_CONFLICT')
  }

  const changed = await db
    .update(servers)
    .set({
      name: nextName,
      handle: nextName,
      settingsVersion: sql`${servers.settingsVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.settingsVersion, expectedVersion),
        ne(servers.status, 'deleted'),
        teamSettingsAccess(team.id, userId),
      ),
    )
    .returning({ settingsVersion: servers.settingsVersion })
  if (!changed.length) throw new PublicError('SETTINGS_CONFLICT')
  return changed[0]!
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
    throw new PublicError('SERVER_NOT_FOUND')
  }

  if (confirmationName !== server.name) {
    throw new PublicError('SERVER_DISABLE_CONFIRMATION')
  }

  const now = new Date()
  if (
    !(await changeServerEnabled(db, {
      userId,
      teamId: team.id,
      serverId,
      enabled: false,
      now,
    }))
  ) {
    throw new PublicError('SERVER_STATE_CHANGED')
  }
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
    throw new PublicError('SERVER_NOT_FOUND')
  }

  if (server.status !== 'disabled') {
    throw new PublicError('SERVER_ENABLE_DISABLED_ONLY')
  }

  const now = new Date()
  if (
    !(await changeServerEnabled(db, {
      userId,
      teamId: team.id,
      serverId,
      enabled: true,
      now,
    }))
  ) {
    throw new PublicError('SERVER_STATE_CHANGED')
  }
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
    throw new PublicError('SERVER_NAME_CONFLICT')
  }

  const serverId = randomUUID()
  const enrollmentToken = `dps_${randomBytes(32).toString('base64url')}`
  const enrollmentTokenHash = hashToken(enrollmentToken)
  const enrollmentTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000)

  const now = new Date()
  await withWorkspaceAccess(team.id, 'server.create', () =>
    db.batch([
      db.insert(servers).values({
        id: serverId,
        teamId: team.id,
        name: nextName,
        handle: nextName,
        status: 'pending',
        enrollmentTokenHash,
        enrollmentTokenExpiresAt,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(serverAvailabilityWindows).values({
        id: randomUUID(),
        serverId,
        startedAt: now,
      }),
    ]),
  )

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
      settingsVersion: servers.settingsVersion,
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
    throw new PublicError('SERVER_NOT_FOUND')
  }

  if (server.status === 'disabled') {
    throw new PublicError('SERVER_DISABLED_ENROLLMENT')
  }

  if (server.status === 'deleted') {
    throw new PublicError('SERVER_DELETED_ENROLLMENT')
  }

  if (
    getEffectiveServerStatus({
      status: server.status,
      lastSeenAt: server.lastSeenAt,
    }) === 'connected'
  ) {
    throw new PublicError('SERVER_CONNECTED_ENROLLMENT')
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
  publicIpv4,
  publicIpv6,
  routingAddress,
}: {
  token: string
  agentVersion?: string | null
  protocolVersion?: number
  capabilities?: Array<string>
  publicAddress: string | null
  routingAddress?: string
  publicIpv4?: string | null
  publicIpv6?: string | null
}): Promise<AgentRegistration> {
  const auth = await findServerForCredential(token)
  const server = auth.server

  if (server.status === 'deleted') {
    throw new AgentRequestError(403, 'Server was deleted.')
  }

  await getDeploymentServices().workspaceAccess?.connected(server.teamId)

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
    ...mergePublicAddresses(server, { publicIpv4, publicIpv6, routingAddress }),
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
  publicIpv4,
  publicIpv6,
  routingAddress,
  runtimeIds,
  runtimes,
  system,
  metricSamples,
}: {
  serverId: string
  token: string
  agentVersion?: string | null
  protocolVersion?: number
  capabilities?: Array<string>
  publicAddress: string | null
  routingAddress?: string
  publicIpv4?: string | null
  publicIpv6?: string | null
  runtimeIds?: Array<string>
  runtimes?: Array<ReportedRuntime>
  system?: HostDetailsInput
  metricSamples?: Array<AgentMetricSample>
}): Promise<AgentRegistration> {
  const auth = await requireAgentCredential(token)
  const server = auth.server

  if (server.id !== serverId) {
    throw new AgentRequestError(401, 'Agent token does not match this server.')
  }

  const now = new Date()
  if (server.status !== 'deleted') {
    const updates = {
      status: 'connected' as const,
      ...(auth.credentialType === 'pending'
        ? {
            agentCredentialHash: server.pendingAgentCredentialHash,
            pendingAgentCredentialHash: null,
            enrollmentTokenHash: null,
            enrollmentTokenExpiresAt: null,
            agentCredentialRotatedAt: now,
          }
        : {}),
      ...(agentVersion ? { agentVersion } : {}),
      ...(protocolVersion ? { agentProtocolVersion: protocolVersion } : {}),
      ...(capabilities ? { agentCapabilities: capabilities } : {}),
      ...mergePublicAddresses(server, {
        publicIpv4,
        publicIpv6,
        routingAddress,
      }),
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
      updatedAt: sql`case when ${servers.status} <> 'connected' or ${Number(auth.credentialType === 'pending')} = 1 then ${now.getTime()} else ${servers.updatedAt} end`,
    }

    const updated = await db
      .update(servers)
      .set(updates)
      .where(
        and(
          eq(servers.id, server.id),
          ne(servers.status, 'disabled'),
          ne(servers.status, 'deleted'),
          eq(
            auth.credentialType === 'pending'
              ? servers.pendingAgentCredentialHash
              : servers.agentCredentialHash,
            hashToken(token),
          ),
        ),
      )
      .returning({ id: servers.id })
    if (!updated.length)
      throw new AgentRequestError(403, 'Server state or credential changed.')
    await recordServerHeartbeat({
      serverId: server.id,
      observedAt: now,
      agentVersion: agentVersion ?? null,
      publicAddress,
    })
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

  const metricsAcceptedThrough =
    server.status === 'deleted'
      ? undefined
      : await recordAgentMetricSamples(server.id, metricSamples ?? [], now)

  const deploymentServices = getDeploymentServices()
  if (deploymentServices.serverLifecycle) {
    const current = await deploymentContext.readServer(server.id)
    if (current) {
      try {
        await deploymentServices.serverLifecycle.reconcile(current)
      } catch {
        console.warn('Server address reconciliation is pending.', {
          serverId: server.id,
        })
      }
    }
  }
  return {
    metricsAcceptedThrough,
    ...(server.status !== 'deleted' && deploymentServices.certificates
      ? { managedCertificates: true }
      : {}),
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
  const credential = `dpa_${randomBytes(32).toString('base64url')}`
  const now = new Date()
  const rotated = await db
    .update(servers)
    .set({
      ...(auth.credentialType === 'pending'
        ? {
            agentCredentialHash: server.pendingAgentCredentialHash,
            enrollmentTokenHash: null,
            agentCredentialRotatedAt: now,
          }
        : {}),
      pendingAgentCredentialHash: hashToken(credential),
      updatedAt: now,
    })
    .where(
      and(
        eq(servers.id, server.id),
        ne(servers.status, 'deleted'),
        sql`agent_credential_hash is ${server.agentCredentialHash}`,
        sql`pending_agent_credential_hash is ${server.pendingAgentCredentialHash}`,
      ),
    )
    .returning({ id: servers.id })
  if (rotated.length !== 1)
    throw new AgentRequestError(
      409,
      'Agent credential changed. Retry rotation.',
    )

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
      settingsVersion: servers.settingsVersion,
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
    throw new PublicError('SERVER_NOT_FOUND')
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
      settingsVersion: servers.settingsVersion,
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
    throw new PublicError('SERVER_NOT_FOUND')
  }

  if (confirmationName !== server.name) {
    throw new PublicError('SERVER_DELETE_CONFIRMATION')
  }

  const now = new Date()

  const changed = await deleteServerState(db, {
    userId,
    teamId: team.id,
    serverId: server.id,
    cancelOngoingDeployments,
    now,
  })
  if (!changed) throw new PublicError('SERVER_ACCESS_CHANGED')
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
    throw new PublicError('SERVER_NAME_INVALID')
  }
}

async function findServerForCredential(token: string) {
  const tokenHash = hashToken(token)
  const rows = await db
    .select({
      settingsVersion: servers.settingsVersion,
      id: servers.id,
      teamId: servers.teamId,
      status: servers.status,
      publicAddress: servers.publicAddress,
      publicIpv4: servers.publicIpv4,
      publicIpv6: servers.publicIpv6,
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
    await recoverStaleCleanupJobs(db, {
      serverId: auth.server.id,
      cleanupJobId,
      now: new Date(),
    })

    if (!(await hasPermittedDeletedServerWork(auth.server.id, cleanupJobId))) {
      throw new AgentRequestError(403, 'Server was deleted.')
    }
  }

  return auth
}

async function hasPermittedDeletedServerWork(
  serverId: string,
  cleanupJobId?: string,
) {
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
          or(
            inArray(agentJobs.status, ['queued', 'running']),
            cleanupJobId ? eq(agentJobs.id, cleanupJobId) : sql`0`,
          ),
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

  return `(tmp="$(mktemp)" && curl -fsSL ${shellQuote(tokenInstallUrl)} -o "$tmp" && sudo bash "$tmp"; status=$?; test -z "\${tmp:-}" || rm -f "$tmp"; exit "$status")`
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function mergePublicAddresses(
  server: {
    publicAddress: string | null
    publicIpv4: string | null
    publicIpv6: string | null
  },
  reported: {
    publicIpv4?: string | null
    publicIpv6?: string | null
    routingAddress?: string
  },
) {
  if (reported.routingAddress) {
    return {
      publicAddress: reported.routingAddress,
      publicIpv4: reported.routingAddress.includes(':')
        ? null
        : reported.routingAddress,
      publicIpv6: reported.routingAddress.includes(':')
        ? reported.routingAddress
        : null,
    }
  }
  const publicIpv4 = reported.publicIpv4 ?? server.publicIpv4
  const publicIpv6 = reported.publicIpv6 ?? server.publicIpv6
  return {
    publicIpv4,
    publicIpv6,
    publicAddress: publicIpv4 ?? publicIpv6 ?? server.publicAddress,
  }
}
