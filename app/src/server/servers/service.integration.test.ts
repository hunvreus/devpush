import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
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
} from '@/server/db/schema'
import {
  createServerInstallCommand,
  createPendingServer,
  deleteTeamServer,
  requireTeamServer,
  updateTeamServer,
  disableTeamServer,
  enableTeamServer,
  getServerDeleteDiagnostic,
  recordAgentHeartbeat,
  registerAgent,
  requireAgentServer,
  rotateAgentCredential,
} from '@/server/servers/service'

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
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('server service integration', () => {
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
    expect(disabledWindows[0].endedAt).toBeInstanceOf(Date)
    await expect(
      createServerInstallCommand({
        userId,
        teamSlug,
        serverId: server.id,
      }),
    ).rejects.toThrow('Disabled servers cannot be enrolled.')
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

    expect(after.tokenHash).toBe(before.tokenHash)
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
        strategy: 'managed',
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
