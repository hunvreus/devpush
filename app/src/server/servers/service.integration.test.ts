import { pluginContext } from '#devpush/server/plugins/server-context'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { switchServerControlPlane } from './switch'
import { required } from '#devpush/test/required'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'

import { closeDb, db } from '#devpush/server/db'
import { currentAgentCapabilities } from '#devpush/server/agents/compatibility'
import { claimNextAgentJob } from '#devpush/server/agents/jobs'
import {
  agentJobs,
  deployments,
  environments,
  projects,
  serverAvailabilityWindows,
  serverHeartbeats,
  serverMetrics,
  servers,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'
import {
  mergePublicAddresses,
  createServerInstallCommand,
  createPendingServer,
  deleteTeamServer,
  requireTeamServer,
  requireServerMetricHistoryForTeam,
  updateTeamServer,
  disableTeamServer,
  enableTeamServer,
  getServerDeleteDiagnostic,
  recordAgentHeartbeat,
  registerAgent,
  requireAgentServer,
  rotateAgentCredential,
} from '#devpush/server/servers/service'

const connectionPolicy = vi.hoisted(() => ({
  beforeWrite: undefined as undefined | (() => Promise<void>),
}))
vi.mock('#devpush/server/plugins/services.server', () => ({
  getPluginServices: () => ({
    workspaceAccess: {
      run: async (_input: unknown, action: () => Promise<unknown>) => {
        await connectionPolicy.beforeWrite?.()
        return action()
      },
    },
  }),
}))

const touchedServerIds: Array<string> = []
const touchedTeamIds: Array<string> = []
const touchedUserIds: Array<string> = []
const touchedProjectIds: Array<string> = []
const touchedEnvironmentIds: Array<string> = []
const touchedDeploymentIds: Array<string> = []
const touchedJobIds: Array<string> = []
const touchedMetricIds: Array<string> = []
const touchedHeartbeatIds: Array<string> = []

afterEach(async () => {
  connectionPolicy.beforeWrite = undefined
  vi.restoreAllMocks()
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('server service integration', () => {
  test('workspace server usage counts pending, disabled and disconnected servers until deletion', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'counted-server',
    })
    touchedServerIds.push(server.id)
    const [stored] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, server.id))
    const initial = await pluginContext.readWorkspace!(stored!.teamId)
    expect(initial!.serverCount).toBe(1)
    for (const status of ['disabled', 'disconnected'] as const) {
      await db
        .update(servers)
        .set({ status, updatedAt: new Date(Date.now() + 10000) })
        .where(eq(servers.id, server.id))
      const usage = await pluginContext.readWorkspace!(stored!.teamId)
      expect(usage!.serverCount).toBe(1)
      expect(usage!.serverCountChangedAt).toBe(initial!.serverCountChangedAt)
    }
    const deletedAt = new Date(Date.now() + 20000)
    await db
      .update(servers)
      .set({ status: 'deleted', updatedAt: deletedAt })
      .where(eq(servers.id, server.id))
    const usage = await pluginContext.readWorkspace!(stored!.teamId)
    expect(usage!.serverCount).toBe(0)
    expect(usage!.serverCountChangedAt).toBe(deletedAt.getTime())
  })

  test.each(['disabled', 'deleted', 'rotated'] as const)(
    'registration cannot undo a concurrent %s change',
    async (change) => {
      const { teamSlug, userId } = await createFixture()
      const server = await createPendingServer({
        userId,
        teamSlug,
        name: 'registration-race',
      })
      touchedServerIds.push(server.id)
      connectionPolicy.beforeWrite = async () => {
        await db
          .update(servers)
          .set(
            change === 'rotated'
              ? { enrollmentTokenHash: '0'.repeat(64) }
              : { status: change },
          )
          .where(eq(servers.id, server.id))
      }
      await expect(
        registerAgent({
          token: required(server.installCommand.match(/dps_[\w-]+/)?.[0]),
          publicAddress: null,
        }),
      ).rejects.toThrow('Server state or credential changed.')
      const [stored] = await db
        .select()
        .from(servers)
        .where(eq(servers.id, server.id))
      expect(stored!.status).toBe(change === 'rotated' ? 'pending' : change)
      expect(stored!.pendingAgentCredentialHash).toBeNull()
    },
  )

  test('routine heartbeats preserve the server settings timestamp while lifecycle transitions advance it', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'heartbeat-timestamp',
    })
    touchedServerIds.push(server.id)
    const registration = await registerAgent({
      token: required(server.installCommand.match(/dps_[\w-]+/)?.[0]),
      publicAddress: null,
    })
    const token = required(registration.credential)
    // The first heartbeat promotes enrollment credentials: a lifecycle change.
    await recordAgentHeartbeat({
      serverId: server.id,
      token,
      publicAddress: null,
    })
    const baseline = new Date(1000)
    await db
      .update(servers)
      .set({ updatedAt: baseline })
      .where(eq(servers.id, server.id))
    await recordAgentHeartbeat({
      serverId: server.id,
      token,
      publicAddress: null,
      agentVersion: 'test-version',
      system: { uptimeSeconds: 123 },
    })
    const [observed] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, server.id))
    expect(observed?.updatedAt).toEqual(baseline)
    expect(observed?.lastSeenAt!.getTime()).toBeGreaterThan(baseline.getTime())
    expect(observed?.hostUptimeSeconds).toBe(123)
    expect(observed?.settingsVersion).toBe(1)
    // Fail if an unchanged metadata column is written, even to the same value.
    const trigger = sql.identifier(
      `unchanged_metadata_${crypto.randomUUID().replaceAll('-', '')}`,
    )
    await db.run(sql`create trigger ${trigger} before update of agent_version on servers
      when old.id = ${sql.raw(`'${server.id.replaceAll("'", "''")}'`)}
      begin select raise(abort, 'Unchanged metadata was rewritten'); end`)
    try {
      await recordAgentHeartbeat({
        serverId: server.id,
        token,
        publicAddress: null,
        agentVersion: 'test-version',
        system: { uptimeSeconds: 124 },
      })
      expect(
        (await db.select().from(servers).where(eq(servers.id, server.id)))[0]
          ?.hostUptimeSeconds,
      ).toBe(124)
    } finally {
      await db.run(sql`drop trigger ${trigger}`)
    }
    await db
      .update(servers)
      .set({ status: 'disconnected' })
      .where(eq(servers.id, server.id))
    await recordAgentHeartbeat({
      serverId: server.id,
      token,
      publicAddress: null,
    })
    const [reconnected] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, server.id))
    expect(reconnected?.updatedAt.getTime()).toBeGreaterThan(baseline.getTime())
  })

  test('a heartbeat cannot reconnect a server disabled after credential lookup', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'heartbeat-race',
    })
    touchedServerIds.push(server.id)
    const registration = await registerAgent({
      token: required(server.installCommand.match(/dps_[\w-]+/)?.[0]),
      publicAddress: null,
    })
    const update = db.update.bind(db)
    vi.spyOn(db, 'update').mockImplementationOnce((table) => {
      const builder = update(table)
      const set = builder.set.bind(builder)
      vi.spyOn(builder, 'set').mockImplementationOnce((values) => {
        const query = set(values)
        const execute = query.execute.bind(query)
        vi.spyOn(query, 'execute').mockImplementationOnce(async () => {
          await update(servers)
            .set({ status: 'disabled' })
            .where(eq(servers.id, server.id))
          return execute()
        })
        return query
      })
      return builder
    })
    await expect(
      recordAgentHeartbeat({
        serverId: server.id,
        token: required(registration.credential),
        publicAddress: null,
      }),
    ).rejects.toThrow('Server state or credential changed.')
    expect(
      (await db.select().from(servers).where(eq(servers.id, server.id)))[0]
        ?.status,
    ).toBe('disabled')
  })

  test('server details exclude history while the independent chart query preserves peaks and team access', async () => {
    const { teamId, teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'chart-history',
    })
    touchedServerIds.push(server.id)
    const now = Date.now()
    await db
      .update(servers)
      .set({ createdAt: new Date(now - 24 * 60 * 60 * 1000) })
      .where(eq(servers.id, server.id))
    await db
      .update(serverAvailabilityWindows)
      .set({ startedAt: new Date(now - 24 * 60 * 60 * 1000) })
      .where(eq(serverAvailabilityWindows.serverId, server.id))
    const rows = Array.from({ length: 2880 }, (_, index) => ({
      id: crypto.randomUUID(),
      serverId: server.id,
      observedAt: new Date(now - (2879 - index) * 30_000),
      cpuPercent: index === 111 ? 99 : 10,
      networkReceiveBytesPerSecond: index === 119 ? 9999 : 10,
    }))
    touchedMetricIds.push(...rows.map((row) => row.id))
    for (let start = 0; start < rows.length; start += 100)
      await db.insert(serverMetrics).values(rows.slice(start, start + 100))
    const detail = await requireTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
    })
    expect(detail).not.toHaveProperty('metricSeries')
    expect(detail).not.toHaveProperty('metricWindow')
    expect(detail.monitoring.latestMetrics?.cpuPercent).toBe(10)
    const history = await requireServerMetricHistoryForTeam({
      teamId,
      serverId: server.id,
    })
    expect(history.points.length).toBeLessThanOrEqual(600)
    expect(history.points.some((point) => point.cpuPercent === 99)).toBe(true)
    expect(
      history.points.some(
        (point) => point.networkReceiveBytesPerSecond === 9999,
      ),
    ).toBe(true)
    await expect(
      requireServerMetricHistoryForTeam({
        teamId: 'foreign-team',
        serverId: server.id,
      }),
    ).rejects.toThrow('Server not found')
    expect(
      await db
        .select({ id: serverMetrics.id })
        .from(serverMetrics)
        .where(eq(serverMetrics.serverId, server.id)),
    ).toHaveLength(2880)
  })

  test('keeps both discovered families and ignores connection-family changes for routing', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'dual-address-test',
    })
    touchedServerIds.push(server.id)
    const registration = await registerAgent({
      token: required(server.installCommand.match(/dps_[\w-]+/)?.[0]),
      publicAddress: '2001:db8::9',
      publicIpv4: '203.0.113.10',
      publicIpv6: '2001:db8::10',
    })
    await recordAgentHeartbeat({
      serverId: server.id,
      token: required(registration.credential),
      publicAddress: '2001:db8::9',
      publicIpv6: '2001:db8::11',
    })
    const rows = await db
      .select()
      .from(servers)
      .where(eq(servers.id, server.id))
    expect(rows[0]).toMatchObject({
      publicAddress: '203.0.113.10',
      publicIpv4: '203.0.113.10',
      publicIpv6: '2001:db8::11',
    })
    await recordAgentHeartbeat({
      serverId: server.id,
      token: required(registration.credential),
      publicAddress: '203.0.113.99',
      routingAddress: '2001:db8::7',
    })
    expect(
      (await db.select().from(servers).where(eq(servers.id, server.id)))[0],
    ).toMatchObject({
      publicAddress: '2001:db8::7',
      publicIpv4: null,
      publicIpv6: '2001:db8::7',
    })
  })

  test('switching pauses an empty server, rejects work, and supports guarded rollback', async () => {
    const { teamId, teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'switch-test',
    })
    touchedServerIds.push(server.id)
    const registration = await registerAgent({
      token: required(server.installCommand.match(/dps_[\w-]+/)?.[0]),
      publicAddress: null,
    })
    const token = required(registration.credential)
    const input = { serverId: server.id, token, action: 'prepare' as const }
    const paused = await switchServerControlPlane(input)
    expect(paused.ticket).toBeTruthy()
    await expect(
      requireAgentServer({ serverId: server.id, token }),
    ).rejects.toThrow('disabled')
    await expect(
      switchServerControlPlane({
        ...input,
        action: 'rollback',
        ticket: 'invalid',
      }),
    ).rejects.toThrow('Invalid rollback ticket')
    await switchServerControlPlane({
      ...input,
      action: 'rollback',
      ticket: paused.ticket,
    })
    await expect(
      switchServerControlPlane({
        ...input,
        action: 'rollback',
        ticket: paused.ticket,
      }),
    ).rejects.toThrow('Source state changed')
    expect(
      (await requireAgentServer({ serverId: server.id, token })).status,
    ).toBe('connected')
    const projectId = `switch-project-${crypto.randomUUID()}`
    touchedProjectIds.push(projectId)
    await db.insert(projects).values({
      id: projectId,
      teamId,
      defaultServerId: server.id,
      slug: projectId,
      name: 'Switch guard',
      githubRepo: 'example/test',
    })
    await expect(switchServerControlPlane(input)).rejects.toThrow('no projects')
    expect(
      (await requireAgentServer({ serverId: server.id, token })).status,
    ).toBe('connected')
  })

  test('creates a server using its machine-safe name', async () => {
    const { teamSlug, userId } = await createFixture()

    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'test-server',
    })
    touchedServerIds.push(server.id)

    expect(server.name).toBe('test-server')
  })

  test('allows owners and admins, but not members, to manage servers', async () => {
    const { teamId, teamSlug, userId } = await createFixture()

    await db
      .update(teamMembers)
      .set({ role: 'member' })
      .where(eq(teamMembers.teamId, teamId))
    await expect(
      createPendingServer({ userId, teamSlug, name: 'member-server' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await db
      .update(teamMembers)
      .set({ role: 'admin' })
      .where(eq(teamMembers.teamId, teamId))
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'admin-server',
    })
    touchedServerIds.push(server.id)

    expect(server.name).toBe('admin-server')
  })

  test('rejects duplicate machine names in the same team', async () => {
    const { teamSlug, userId } = await createFixture()

    const first = await createPendingServer({
      userId,
      teamSlug,
      name: 'test-server',
    })
    touchedServerIds.push(first.id)

    expect(first.name).toBe('test-server')
    await expect(
      createPendingServer({
        userId,
        teamSlug,
        name: 'TEST-SERVER',
      }),
    ).rejects.toThrow('Server names must be unique within a team.')
  })

  test('rejects server machine names with spaces', async () => {
    const { teamSlug, userId } = await createFixture()

    await expect(
      createPendingServer({
        userId,
        teamSlug,
        name: 'invalid server',
      }),
    ).rejects.toThrow('Server names can only contain letters')
  })

  test('renames the server name', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'initial-server',
    })
    touchedServerIds.push(server.id)

    await updateTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
      name: 'renamed-server',
    })

    const updated = await requireTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
    })

    expect(updated.name).toBe('renamed-server')
  })

  test('disables a server and blocks new install commands', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'server-to-disable',
    })
    touchedServerIds.push(server.id)

    await disableTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
      confirmationName: server.name,
    })

    const disabled = await requireTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
    })

    expect(disabled.status).toBe('disabled')
    const disabledWindows = await db
      .select({ endedAt: serverAvailabilityWindows.endedAt })
      .from(serverAvailabilityWindows)
      .where(eq(serverAvailabilityWindows.serverId, server.id))
    expect(disabledWindows).toHaveLength(1)
    expect(required(disabledWindows[0]).endedAt).toBeInstanceOf(Date)
    await expect(
      createServerInstallCommand({
        userId,
        teamSlug,
        serverId: server.id,
      }),
    ).rejects.toThrow('Disabled servers cannot be enrolled.')
  })

  test('the generated installer does not exit its calling shell', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'installer-shell',
    })
    touchedServerIds.push(server.id)
    const bin = mkdtempSync(join(tmpdir(), 'devpush-install-command-'))
    try {
      writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexit 7\n', { mode: 0o755 })
      const output = execFileSync(
        'sh',
        ['-c', `${server.installCommand}; printf 'shell-still-running'`],
        {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          encoding: 'utf8',
        },
      )
      expect(output).toBe('shell-still-running')
    } finally {
      rmSync(bin, { recursive: true, force: true })
    }
  })

  test('does not rotate the credential of a connected server', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'connected-server',
    })
    touchedServerIds.push(server.id)

    await db
      .update(servers)
      .set({ status: 'connected', lastSeenAt: new Date() })
      .where(eq(servers.id, server.id))

    const [before] = await db
      .select({ tokenHash: servers.enrollmentTokenHash })
      .from(servers)
      .where(eq(servers.id, server.id))

    await expect(
      createServerInstallCommand({
        userId,
        teamSlug,
        serverId: server.id,
      }),
    ).rejects.toThrow('Connected servers cannot be re-enrolled.')

    const [after] = await db
      .select({ tokenHash: servers.enrollmentTokenHash })
      .from(servers)
      .where(eq(servers.id, server.id))

    expect(required(after).tokenHash).toBe(required(before).tokenHash)
  })

  test('enables a disabled server as pending', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'server-to-enable',
    })
    touchedServerIds.push(server.id)

    await disableTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
      confirmationName: server.name,
    })
    await enableTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
    })

    const enabled = await requireTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
    })

    expect(enabled.status).toBe('pending')
    const availabilityWindows = await db
      .select({ endedAt: serverAvailabilityWindows.endedAt })
      .from(serverAvailabilityWindows)
      .where(eq(serverAvailabilityWindows.serverId, server.id))
    expect(availabilityWindows).toHaveLength(2)
    expect(
      availabilityWindows.filter((window) => window.endedAt === null),
    ).toHaveLength(1)
  })

  test('exchanges enrollment for a persisted credential and rotates safely', async () => {
    const { teamSlug, userId } = await createFixture()
    const created = await createPendingServer({
      userId,
      teamSlug,
      name: 'credential-server',
    })
    touchedServerIds.push(created.id)
    const enrollmentToken = created.installCommand.match(/dps_[\w-]+/)?.[0]
    expect(enrollmentToken).toBeTruthy()

    const registration = await registerAgent({
      token: enrollmentToken!,
      agentVersion: '1.0.0',
      publicAddress: null,
    })
    expect(registration.credential).toMatch(/^dpa_/)

    await recordAgentHeartbeat({
      serverId: created.id,
      token: registration.credential!,
      agentVersion: '1.0.0',
      publicAddress: null,
    })
    await expect(
      requireAgentServer({
        serverId: created.id,
        token: enrollmentToken!,
      }),
    ).rejects.toThrow('Invalid or expired agent credential.')

    const rotation = await rotateAgentCredential({
      serverId: created.id,
      token: registration.credential!,
    })
    expect(rotation.credential).toMatch(/^dpa_/)

    const retriedRotation = await rotateAgentCredential({
      serverId: created.id,
      token: rotation.credential!,
    })
    expect(retriedRotation.credential).toMatch(/^dpa_/)
    expect(retriedRotation.credential).not.toBe(rotation.credential)

    await recordAgentHeartbeat({
      serverId: created.id,
      token: retriedRotation.credential!,
      agentVersion: '1.0.0',
      publicAddress: null,
    })
    await expect(
      requireAgentServer({
        serverId: created.id,
        token: registration.credential!,
      }),
    ).rejects.toThrow('Invalid or expired agent credential.')
  })

  test('allows deleted servers to finish work but rejects idle credentials', async () => {
    const { teamId, teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'deleted-work-server',
    })
    touchedServerIds.push(server.id)
    const enrollmentToken = server.installCommand.match(/dps_[\w-]+/)?.[0]
    expect(enrollmentToken).toBeTruthy()

    const registration = await registerAgent({
      token: enrollmentToken!,
      agentVersion: '1.0.0',
      publicAddress: null,
    })
    const credential = registration.credential!

    await db
      .update(servers)
      .set({ status: 'deleted' })
      .where(eq(servers.id, server.id))

    await expect(
      requireAgentServer({ serverId: server.id, token: credential }),
    ).rejects.toThrow('Server was deleted.')

    const jobId = `it-cleanup-job-${crypto.randomUUID()}`
    touchedJobIds.push(jobId)
    await db.insert(agentJobs).values({
      id: jobId,
      type: 'deprovision',
      serverId: server.id,
      teamId,
      payload: {
        schemaVersion: 1,
        runtimeIds: ['runtime-to-remove'],
        removeVolumes: false,
        reason: 'Team deleted.',
      },
    })

    await expect(
      requireAgentServer({ serverId: server.id, token: credential }),
    ).resolves.toMatchObject({ id: server.id, status: 'deleted' })

    const backupJobId = `it-backup-job-${crypto.randomUUID()}`
    touchedJobIds.push(backupJobId)
    await db
      .update(agentJobs)
      .set({ availableAt: new Date(Date.now() + 60_000) })
      .where(eq(agentJobs.id, jobId))
    await db.insert(agentJobs).values({
      id: backupJobId,
      type: 'backup',
      serverId: server.id,
      teamId,
      payload: { schemaVersion: 1 },
    })

    await expect(
      claimNextAgentJob({
        serverId: server.id,
        token: credential,
        protocolVersion: 1,
        capabilities: [...currentAgentCapabilities],
      }),
    ).resolves.toBeNull()

    await db
      .update(agentJobs)
      .set({ status: 'succeeded', finishedAt: new Date() })
      .where(eq(agentJobs.id, jobId))

    await expect(
      requireAgentServer({ serverId: server.id, token: credential }),
    ).rejects.toThrow('Server was deleted.')
    await expect(
      db
        .select({ status: agentJobs.status })
        .from(agentJobs)
        .where(eq(agentJobs.id, backupJobId)),
    ).resolves.toEqual([{ status: 'queued' }])

    const staleClaimedAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await db
      .update(agentJobs)
      .set({
        status: 'running',
        attempt: 1,
        maxAttempts: 2,
        claimedAt: staleClaimedAt,
        finishedAt: null,
      })
      .where(eq(agentJobs.id, jobId))

    await expect(
      requireAgentServer({
        serverId: server.id,
        token: credential,
        cleanupJobId: jobId,
      }),
    ).resolves.toMatchObject({ id: server.id })
    await expect(
      db
        .select({ status: agentJobs.status })
        .from(agentJobs)
        .where(eq(agentJobs.id, jobId)),
    ).resolves.toEqual([{ status: 'running' }])

    await expect(
      requireAgentServer({ serverId: server.id, token: credential }),
    ).resolves.toMatchObject({ id: server.id })
    await expect(
      db
        .select({ status: agentJobs.status })
        .from(agentJobs)
        .where(eq(agentJobs.id, jobId)),
    ).resolves.toEqual([{ status: 'queued' }])

    await db
      .update(agentJobs)
      .set({
        status: 'running',
        attempt: 2,
        claimedAt: staleClaimedAt,
      })
      .where(eq(agentJobs.id, jobId))

    await expect(
      requireAgentServer({
        serverId: server.id,
        token: credential,
        cleanupJobId: jobId,
      }),
    ).resolves.toMatchObject({ id: server.id })

    await expect(
      requireAgentServer({ serverId: server.id, token: credential }),
    ).rejects.toThrow('Server was deleted.')
    await expect(
      db
        .select({ status: agentJobs.status })
        .from(agentJobs)
        .where(eq(agentJobs.id, jobId)),
    ).resolves.toEqual([{ status: 'abandoned' }])
  })

  test('allows reusing server names after soft delete', async () => {
    const { teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'reusable-server',
    })
    touchedServerIds.push(server.id)

    await expect(
      createPendingServer({
        userId,
        teamSlug,
        name: 'reusable-server',
      }),
    ).rejects.toThrow('Server names must be unique within a team.')

    await deleteTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
      confirmationName: server.name,
      cancelOngoingDeployments: true,
    })

    const next = await createPendingServer({
      userId,
      teamSlug,
      name: 'reusable-server',
    })
    touchedServerIds.push(next.id)

    expect(next.name).toBe('reusable-server')
  })

  test('counts environments inheriting a project default server', async () => {
    const { teamId, teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'inherited-server',
    })
    touchedServerIds.push(server.id)
    const projectId = `inherited-project-${crypto.randomUUID()}`
    const environmentId = `inherited-environment-${crypto.randomUUID()}`
    touchedProjectIds.push(projectId)
    touchedEnvironmentIds.push(environmentId)

    await db.insert(projects).values({
      id: projectId,
      teamId,
      defaultServerId: server.id,
      slug: `inherited-project-${crypto.randomUUID()}`,
      name: 'Inherited project',
      githubRepo: 'example/inherited-project',
    })
    await db.insert(environments).values({
      id: environmentId,
      projectId,
      serverId: null,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      isProduction: true,
      runtimeId: `inherited-runtime-${crypto.randomUUID()}`,
    })

    await expect(
      getServerDeleteDiagnostic({
        userId,
        teamSlug,
        serverId: server.id,
      }),
    ).resolves.toMatchObject({
      projectCount: 1,
      environmentCount: 1,
    })
  })

  test('soft deletes a server, deletes monitoring data, and can cancel active deployments', async () => {
    const { teamId, teamSlug, userId } = await createFixture()
    const server = await createPendingServer({
      userId,
      teamSlug,
      name: 'server-to-delete',
    })
    touchedServerIds.push(server.id)
    const projectId = `server-delete-project-${crypto.randomUUID()}`
    const environmentId = `server-delete-environment-${crypto.randomUUID()}`
    const queuedDeploymentId = `server-delete-deployment-${crypto.randomUUID()}`
    const runningDeploymentId = `server-delete-deployment-${crypto.randomUUID()}`
    const succeededDeploymentId = `server-delete-deployment-${crypto.randomUUID()}`
    const jobId = `server-delete-job-${crypto.randomUUID()}`
    const metricId = `server-delete-metric-${crypto.randomUUID()}`
    const heartbeatId = `server-delete-heartbeat-${crypto.randomUUID()}`
    const now = new Date()

    touchedProjectIds.push(projectId)
    touchedEnvironmentIds.push(environmentId)
    touchedDeploymentIds.push(
      queuedDeploymentId,
      runningDeploymentId,
      succeededDeploymentId,
    )
    touchedJobIds.push(jobId)
    touchedMetricIds.push(metricId)
    touchedHeartbeatIds.push(heartbeatId)

    await db.insert(projects).values({
      id: projectId,
      teamId,
      slug: 'server-delete-project',
      name: 'Server delete project',
      githubRepo: 'example/server-delete-project',
    })
    await db.insert(environments).values({
      id: environmentId,
      projectId,
      serverId: server.id,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      runtimeId: 'server-delete-runtime',
    })
    await db.insert(deployments).values([
      makeDeployment({
        id: queuedDeploymentId,
        environmentId,
        serverId: server.id,
        status: 'queued',
        runtimeId: 'server-delete-queued',
      }),
      makeDeployment({
        id: runningDeploymentId,
        environmentId,
        serverId: server.id,
        status: 'running',
        runtimeId: 'server-delete-running',
      }),
      makeDeployment({
        id: succeededDeploymentId,
        environmentId,
        serverId: server.id,
        status: 'succeeded',
        runtimeId: 'server-delete-succeeded',
        finishedAt: now,
      }),
    ])
    await db.insert(agentJobs).values({
      id: jobId,
      type: 'deploy',
      status: 'running',
      serverId: server.id,
      teamId,
      projectId,
      payload: { schemaVersion: 1 },
    })
    await db.insert(serverMetrics).values({
      id: metricId,
      serverId: server.id,
      observedAt: now,
    })
    await db.insert(serverHeartbeats).values({
      id: heartbeatId,
      serverId: server.id,
      observedAt: now,
    })

    await expect(
      getServerDeleteDiagnostic({
        userId,
        teamSlug,
        serverId: server.id,
      }),
    ).resolves.toMatchObject({
      projectCount: 1,
      environmentCount: 1,
    })

    await deleteTeamServer({
      userId,
      teamSlug,
      serverId: server.id,
      confirmationName: server.name,
      cancelOngoingDeployments: true,
    })

    const [serverRows, deploymentRows, jobRows, metricRows, heartbeatRows] =
      await Promise.all([
        db
          .select({ status: servers.status })
          .from(servers)
          .where(eq(servers.id, server.id)),
        db
          .select({
            id: deployments.id,
            status: deployments.status,
            errorMessage: deployments.errorMessage,
            finishedAt: deployments.finishedAt,
          })
          .from(deployments)
          .where(
            inArray(deployments.id, [
              queuedDeploymentId,
              runningDeploymentId,
              succeededDeploymentId,
            ]),
          ),
        db
          .select({
            status: agentJobs.status,
            errorMessage: agentJobs.errorMessage,
          })
          .from(agentJobs)
          .where(eq(agentJobs.id, jobId)),
        db
          .select({ id: serverMetrics.id })
          .from(serverMetrics)
          .where(eq(serverMetrics.id, metricId)),
        db
          .select({ id: serverHeartbeats.id })
          .from(serverHeartbeats)
          .where(eq(serverHeartbeats.id, heartbeatId)),
      ])
    const deploymentsById = new Map(
      deploymentRows.map((deployment) => [deployment.id, deployment]),
    )

    expect(serverRows).toEqual([{ status: 'deleted' }])
    expect(deploymentsById.get(queuedDeploymentId)).toMatchObject({
      status: 'canceled',
      errorMessage: 'Canceled because the server was deleted.',
    })
    expect(deploymentsById.get(queuedDeploymentId)?.finishedAt).toBeInstanceOf(
      Date,
    )
    expect(deploymentsById.get(runningDeploymentId)).toMatchObject({
      status: 'canceled',
      errorMessage: 'Canceled because the server was deleted.',
    })
    expect(deploymentsById.get(succeededDeploymentId)).toMatchObject({
      status: 'succeeded',
      errorMessage: null,
    })
    expect(jobRows).toEqual([
      {
        status: 'canceled',
        errorMessage: 'Canceled because the server was deleted.',
      },
    ])
    expect(metricRows).toEqual([])
    expect(heartbeatRows).toEqual([])
  })
})

async function createFixture() {
  const suffix = crypto.randomUUID()
  const userId = `server-user-${suffix}`
  const teamId = `server-team-${suffix}`
  const teamSlug = `server-team-${suffix}`

  touchedUserIds.push(userId)
  touchedTeamIds.push(teamId)

  await db.insert(user).values({
    id: userId,
    name: 'Server User',
    username: `server-${suffix.slice(0, 12)}`,
    email: `server-${suffix}@example.com`,
    emailVerified: true,
  })
  await db.insert(teams).values({
    id: teamId,
    slug: teamSlug,
    name: 'Server Team',
  })
  await db.insert(teamMembers).values({
    id: `server-member-${suffix}`,
    teamId,
    userId,
    role: 'owner',
  })

  return { teamId, teamSlug, userId }
}

function makeDeployment({
  environmentId,
  finishedAt,
  id,
  runtimeId,
  serverId,
  status,
}: {
  environmentId: string
  finishedAt?: Date
  id: string
  runtimeId: string
  serverId: string
  status: 'queued' | 'running' | 'succeeded'
}) {
  return {
    id,
    environmentId,
    serverId,
    status,
    phase: status === 'succeeded' ? 'complete' : null,
    repoId: 1,
    repoFullName: 'example/server-delete-project',
    commitMeta: {},
    gitSha: 'abc123',
    gitBranch: 'main',
    config: {
      schemaVersion: 1,
      runtime: {
        type: 'compose',
        path: 'compose.yml',
        releaseCommand: null,
        releaseService: 'web',
        readinessPath: null,
        deployCommand: null,
        rollbackCommand: null,
        timeoutSeconds: 1800,
      },
      routes: [],
    },
    envVars: 'encrypted-env-vars',
    runtimeId,
    finishedAt,
  }
}

async function cleanupRows() {
  if (touchedJobIds.length > 0) {
    await db.delete(agentJobs).where(inArray(agentJobs.id, touchedJobIds))
    touchedJobIds.length = 0
  }

  if (touchedMetricIds.length > 0) {
    await db
      .delete(serverMetrics)
      .where(inArray(serverMetrics.id, touchedMetricIds))
    touchedMetricIds.length = 0
  }

  if (touchedHeartbeatIds.length > 0) {
    await db
      .delete(serverHeartbeats)
      .where(inArray(serverHeartbeats.id, touchedHeartbeatIds))
    touchedHeartbeatIds.length = 0
  }

  if (touchedDeploymentIds.length > 0) {
    await db
      .delete(deployments)
      .where(inArray(deployments.id, touchedDeploymentIds))
    touchedDeploymentIds.length = 0
  }

  if (touchedEnvironmentIds.length > 0) {
    await db
      .delete(environments)
      .where(inArray(environments.id, touchedEnvironmentIds))
    touchedEnvironmentIds.length = 0
  }

  if (touchedProjectIds.length > 0) {
    await db.delete(projects).where(inArray(projects.id, touchedProjectIds))
    touchedProjectIds.length = 0
  }

  if (touchedServerIds.length > 0) {
    await db.delete(servers).where(inArray(servers.id, touchedServerIds))
    touchedServerIds.length = 0
  }

  if (touchedTeamIds.length > 0) {
    await db
      .delete(teamMembers)
      .where(inArray(teamMembers.teamId, touchedTeamIds))
    await db.delete(teams).where(inArray(teams.id, touchedTeamIds))
    touchedTeamIds.length = 0
  }

  if (touchedUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, touchedUserIds))
    touchedUserIds.length = 0
  }
}

test('pinned routing address replaces discovered families, including an old preferred IPv4', () => {
  const server = {
    publicAddress: '203.0.113.9',
    publicIpv4: '203.0.113.9',
    publicIpv6: '2001:db8::9',
  }
  expect(
    mergePublicAddresses(server, { routingAddress: '2001:db8::7' }),
  ).toEqual({
    publicAddress: '2001:db8::7',
    publicIpv4: null,
    publicIpv6: '2001:db8::7',
  })
  expect(
    mergePublicAddresses(server, { routingAddress: '192.168.64.7' }),
  ).toEqual({
    publicAddress: '192.168.64.7',
    publicIpv4: '192.168.64.7',
    publicIpv6: null,
  })
  expect(mergePublicAddresses(server, {})).toEqual(server)
})

test('browser server creation cannot charge after the actor loses manager authority during admission', async () => {
  const f = await createFixture()
  connectionPolicy.beforeWrite = async () => {
    await db
      .update(teamMembers)
      .set({ role: 'member' })
      .where(eq(teamMembers.userId, f.userId))
  }
  await expect(
    createPendingServer({
      userId: f.userId,
      teamSlug: f.teamSlug,
      name: 'blocked-by-demotion',
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  expect(
    await db.select().from(servers).where(eq(servers.teamId, f.teamId)),
  ).toHaveLength(0)
})
