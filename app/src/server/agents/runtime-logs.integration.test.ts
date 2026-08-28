import { createHash } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import {
  environments,
  projects,
  runtimeLogs,
  servers,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import { getProjectLogsContext } from '@/server/projects/service'
import { recordAgentHeartbeat } from '@/server/servers/service'
import { recordRuntimeLogs } from './runtime-logs'

const touchedRuntimeLogIds: Array<string> = []
const touchedEnvironmentIds: Array<string> = []
const touchedProjectIds: Array<string> = []
const touchedServerIds: Array<string> = []
const touchedTeamIds: Array<string> = []
const touchedUserIds: Array<string> = []

afterEach(async () => {
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('runtime log ingestion', () => {
  test('records assigned runtime logs and deduplicates repeated batches', async () => {
    const { projectName, serverId, teamSlug, token, userId } =
      await createFixture()
    const observedAt = new Date().toISOString()
    const payload = {
      serverId,
      token,
      logs: [
        {
          runtimeId: 'dp_project_production',
          service: 'web',
          observedAt,
          content: 'Listening on 3000',
        },
        {
          runtimeId: 'dp_project_other',
          service: 'web',
          observedAt,
          content: 'Should be ignored',
        },
      ],
    }

    await recordRuntimeLogs(payload)
    await recordRuntimeLogs(payload)

    const rows = await db
      .select({
        id: runtimeLogs.id,
        runtimeId: runtimeLogs.runtimeId,
        service: runtimeLogs.service,
        content: runtimeLogs.content,
      })
      .from(runtimeLogs)
      .where(eq(runtimeLogs.serverId, serverId))
    touchedRuntimeLogIds.push(...rows.map((row) => row.id))

    expect(rows).toEqual([
      {
        id: expect.any(String),
        runtimeId: 'dp_project_production',
        service: 'web',
        content: 'Listening on 3000',
      },
    ])

    const context = await getProjectLogsContext({
      userId,
      teamSlug,
      projectName,
      keyword: 'Listening',
    })

    expect(context.logs).toContainEqual(
      expect.objectContaining({
        source: 'runtime',
        deploymentId: null,
        runtimeId: 'dp_project_production',
        service: 'web',
        stream: 'runtime',
        content: 'Listening on 3000',
      }),
    )
  })

  test('prunes runtime logs older than 24 hours during ingestion', async () => {
    const { serverId, token } = await createFixture()
    const oldObservedAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const currentObservedAt = new Date()
    const oldLogId = `runtime-log-${crypto.randomUUID()}`

    touchedRuntimeLogIds.push(oldLogId)
    await db.insert(runtimeLogs).values({
      id: oldLogId,
      serverId,
      runtimeId: 'dp_project_production',
      service: 'web',
      observedAt: oldObservedAt,
      content: 'old runtime line',
      contentHash: hashRuntimeLogLine({
        runtimeId: 'dp_project_production',
        service: 'web',
        observedAt: oldObservedAt,
        content: 'old runtime line',
      }),
    })

    await recordRuntimeLogs({
      serverId,
      token,
      logs: [
        {
          runtimeId: 'dp_project_production',
          service: 'web',
          observedAt: currentObservedAt.toISOString(),
          content: 'current runtime line',
        },
      ],
    })

    const rows = await db
      .select({
        id: runtimeLogs.id,
        content: runtimeLogs.content,
      })
      .from(runtimeLogs)
      .where(eq(runtimeLogs.serverId, serverId))
    touchedRuntimeLogIds.push(...rows.map((row) => row.id))

    expect(rows.map((row) => row.content).sort()).toEqual([
      'current runtime line',
    ])
  })

  test('accepts logs for environments inheriting the project server', async () => {
    const { projectId, projectName, serverId, teamSlug, token, userId } =
      await createFixture()

    await db
      .update(projects)
      .set({ defaultServerId: serverId })
      .where(eq(projects.id, projectId))
    await db
      .update(environments)
      .set({ serverId: null })
      .where(eq(environments.projectId, projectId))

    const heartbeat = await recordAgentHeartbeat({
      serverId,
      token,
      publicAddress: null,
    })
    expect(heartbeat.runtimeLogTargets).toEqual([
      { runtimeId: 'dp_project_production' },
    ])

    await recordRuntimeLogs({
      serverId,
      token,
      logs: [
        {
          runtimeId: 'dp_project_production',
          service: 'web',
          observedAt: new Date().toISOString(),
          content: 'Inherited server log',
        },
      ],
    })

    const rows = await db
      .select({ id: runtimeLogs.id, content: runtimeLogs.content })
      .from(runtimeLogs)
      .where(eq(runtimeLogs.serverId, serverId))
    touchedRuntimeLogIds.push(...rows.map((row) => row.id))

    expect(rows).toEqual([
      { id: expect.any(String), content: 'Inherited server log' },
    ])

    const context = await getProjectLogsContext({
      userId,
      teamSlug,
      projectName,
      keyword: 'Inherited',
    })
    expect(context.logs).toContainEqual(
      expect.objectContaining({
        source: 'runtime',
        runtimeId: 'dp_project_production',
        content: 'Inherited server log',
      }),
    )
  })

  test('rejects inherited runtime logs from a different server', async () => {
    const { projectId, serverId, teamId, token } = await createFixture()
    const assignedServerId = `server-${crypto.randomUUID()}`
    touchedServerIds.push(assignedServerId)
    await db.insert(servers).values({
      id: assignedServerId,
      teamId,
      name: `server-${crypto.randomUUID()}`,
      handle: `server-${crypto.randomUUID()}`,
      status: 'connected',
    })
    await db
      .update(projects)
      .set({ defaultServerId: assignedServerId })
      .where(eq(projects.id, projectId))
    await db
      .update(environments)
      .set({ serverId: null })
      .where(eq(environments.projectId, projectId))

    await recordRuntimeLogs({
      serverId,
      token,
      logs: [
        {
          runtimeId: 'dp_project_production',
          service: 'web',
          observedAt: new Date().toISOString(),
          content: 'Wrong server log',
        },
      ],
    })

    const rows = await db
      .select({ id: runtimeLogs.id })
      .from(runtimeLogs)
      .where(eq(runtimeLogs.serverId, serverId))

    expect(rows).toEqual([])
  })
})

async function createFixture() {
  const suffix = crypto.randomUUID()
  const token = `token-${suffix}`
  const userId = `user-${suffix}`
  const teamId = `team-${suffix}`
  const serverId = `server-${suffix}`
  const projectId = `project-${suffix}`
  const environmentId = `environment-${suffix}`

  touchedUserIds.push(userId)
  touchedTeamIds.push(teamId)
  touchedServerIds.push(serverId)
  touchedProjectIds.push(projectId)
  touchedEnvironmentIds.push(environmentId)

  await db.insert(user).values({
    id: userId,
    name: 'Runtime Logs User',
    username: `runtime-${suffix.slice(0, 12)}`,
    email: `runtime-${suffix}@example.com`,
    emailVerified: true,
  })
  await db.insert(teams).values({
    id: teamId,
    slug: `team-${suffix}`,
    name: 'Runtime Logs Team',
  })
  await db.insert(teamMembers).values({
    id: `member-${suffix}`,
    teamId,
    userId,
    role: 'owner',
  })
  await db.insert(servers).values({
    id: serverId,
    teamId,
    name: `server-${suffix}`,
    handle: `server-${suffix}`,
    status: 'connected',
    agentCredentialHash: hashToken(token),
  })
  await db.insert(projects).values({
    id: projectId,
    teamId,
    slug: `project-${suffix}`,
    name: 'Runtime Logs Project',
    githubRepo: 'acme/app',
  })
  await db.insert(environments).values({
    id: environmentId,
    projectId,
    serverId,
    name: 'Production',
    slug: 'production',
    branch: 'main',
    isProduction: true,
    runtimeId: 'dp_project_production',
  })

  return {
    projectId,
    projectName: `project-${suffix}`,
    serverId,
    teamId,
    teamSlug: `team-${suffix}`,
    token,
    userId,
  }
}

async function cleanupRows() {
  if (touchedRuntimeLogIds.length > 0) {
    await db
      .delete(runtimeLogs)
      .where(inArray(runtimeLogs.id, touchedRuntimeLogIds))
    touchedRuntimeLogIds.length = 0
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

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function hashRuntimeLogLine({
  runtimeId,
  service,
  observedAt,
  content,
}: {
  runtimeId: string
  service: string
  observedAt: Date
  content: string
}) {
  return createHash('sha256')
    .update(runtimeId)
    .update('\0')
    .update(service)
    .update('\0')
    .update(observedAt.toISOString())
    .update('\0')
    .update(content)
    .digest('hex')
}
