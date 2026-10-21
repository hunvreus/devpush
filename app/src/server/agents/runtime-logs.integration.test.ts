import { required } from '@/test/required'
import { createHash } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'

import { closeDb, db, logsDb } from '@/server/db'
import {
  deployments,
  environments,
  projects,
  servers,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import { runtimeLogs } from '@/server/db/log-schema'
import { getProjectLogsSectionContext } from '@/server/projects/context'
import { recordAgentHeartbeat } from '@/server/servers/service'
import { recordRuntimeLogs } from './runtime-logs'

const touchedRuntimeLogIds: Array<string> = []
const touchedEnvironmentIds: Array<string> = []
const touchedProjectIds: Array<string> = []
const touchedServerIds: Array<string> = []
const touchedTeamIds: Array<string> = []
const touchedUserIds: Array<string> = []

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('runtime log ingestion', () => {
  test.each(['replaced', 'deleted'] as const)(
    'delivers captured %s-runtime logs only from their historical server',
    async (state) => {
      const { environmentId, projectId, serverId, token } =
        await createFixture()
      const historicalRuntime = `dp_historical_${crypto.randomUUID()}`
      await db.insert(deployments).values({
        id: crypto.randomUUID(),
        environmentId,
        serverId,
        runtimeId: historicalRuntime,
        status: 'succeeded',
        repoId: 1,
        repoFullName: 'acme/app',
        gitSha: 'abc',
        gitBranch: 'main',
        config: {},
        envVars: '',
      })
      await db
        .update(environments)
        .set({
          runtimeId: 'dp_replacement',
          ...(state === 'deleted' ? { status: 'deleted' as const } : {}),
        })
        .where(eq(environments.id, environmentId))
      if (state === 'deleted')
        await db
          .update(projects)
          .set({ status: 'deleted' })
          .where(eq(projects.id, projectId))
      const logs = [
        {
          runtimeId: historicalRuntime,
          service: 'web',
          observedAt: new Date().toISOString(),
          content: 'Captured before replacement',
        },
      ]
      expect(await recordRuntimeLogs({ serverId, token, logs })).toEqual({
        ok: true,
        accepted: 1,
        inserted: 1,
      })
      expect(await recordRuntimeLogs({ serverId, token, logs })).toEqual({
        ok: true,
        accepted: 1,
        inserted: 0,
      })
      const other = await createFixture()
      expect(
        await recordRuntimeLogs({
          serverId: other.serverId,
          token: other.token,
          logs,
        }),
      ).toEqual({ ok: true, accepted: 0, inserted: 0 })
      const rows = await logsDb
        .select()
        .from(runtimeLogs)
        .where(eq(runtimeLogs.serverId, serverId))
      touchedRuntimeLogIds.push(...rows.map((row) => row.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        projectId,
        environmentId,
        runtimeId: historicalRuntime,
      })
    },
  )
  test('bounds inserts and reads across more than one assignment batch', async () => {
    const { projectId, projectName, serverId, teamSlug, token, userId } =
      await createFixture()
    const environmentIds: string[] = []
    for (let index = 0; index < 25; index++) {
      const id = crypto.randomUUID()
      environmentIds.push(id)
      touchedEnvironmentIds.push(id)
      await db.insert(environments).values({
        id,
        projectId,
        serverId,
        name: `Branch ${index}`,
        slug: `branch-${index}`,
        branch: `branch-${index}`,
        runtimeId: `runtime-${index}`,
      })
    }
    const batch = vi.spyOn(logsDb, 'batch')
    const start = Date.now() - 1000
    const logs = Array.from({ length: 500 }, (_, index) => ({
      runtimeId: `runtime-${index % 25}`,
      service: 'web',
      observedAt: new Date(start + index).toISOString(),
      content: `line ${index}`,
    }))
    expect(await recordRuntimeLogs({ serverId, token, logs })).toEqual({
      ok: true,
      accepted: 500,
      inserted: 500,
    })
    for (const [statements] of batch.mock.calls) {
      expect(statements.length).toBeLessThanOrEqual(4)
      for (const statement of statements) {
        // Drizzle's BatchItem type erases the insert builder's toSQL method.
        const insert = statement as ReturnType<
          ReturnType<typeof logsDb.insert>['values']
        >
        expect(insert.toSQL().params.length).toBeLessThanOrEqual(100)
      }
    }
    const stored = await logsDb
      .select({ id: runtimeLogs.id })
      .from(runtimeLogs)
      .where(eq(runtimeLogs.serverId, serverId))
    touchedRuntimeLogIds.push(...stored.map((row) => row.id))
    const context = { userId, teamSlug, projectName }
    const all = await getProjectLogsSectionContext(context)
    expect(all.logs).toHaveLength(200)
    expect(required(all.logs[0]).content).toBe('line 499')
    const lastBranch = await getProjectLogsSectionContext({
      ...context,
      branch: 'branch-24',
      environmentId: environmentIds[24],
    })
    expect(lastBranch.logs).toHaveLength(20)
    expect(lastBranch.logs.every((row) => row.runtimeId === 'runtime-24')).toBe(
      true,
    )
  })

  test('replays a partially stored request without acknowledging failure or duplicating lines', async () => {
    const { serverId, token } = await createFixture()
    const logs = Array.from({ length: 40 }, (_, index) => ({
      runtimeId: 'dp_project_production',
      service: 'web',
      observedAt: new Date().toISOString(),
      content: `line ${index}`,
    }))
    const insert = logsDb.insert.bind(logsDb)
    let calls = 0
    const failure = vi.spyOn(logsDb, 'insert').mockImplementation((table) => {
      if (++calls === 5) throw new Error('storage unavailable')
      return insert(table)
    })
    await expect(recordRuntimeLogs({ serverId, token, logs })).rejects.toThrow(
      'storage unavailable',
    )
    failure.mockRestore()
    const partial = await logsDb
      .select()
      .from(runtimeLogs)
      .where(eq(runtimeLogs.serverId, serverId))
    touchedRuntimeLogIds.push(...partial.map((row) => row.id))
    expect(partial).toHaveLength(32)
    expect(await recordRuntimeLogs({ serverId, token, logs })).toEqual({
      ok: true,
      accepted: 40,
      inserted: 8,
    })
    const stored = await logsDb
      .select()
      .from(runtimeLogs)
      .where(eq(runtimeLogs.serverId, serverId))
    touchedRuntimeLogIds.push(...stored.map((row) => row.id))
    expect(stored).toHaveLength(40)
  })

  test('filters separate storage by current branch, assignment and project permissions', async () => {
    const { projectId, projectName, serverId, teamSlug, token, userId } =
      await createFixture()
    await recordRuntimeLogs({
      serverId,
      token,
      logs: [
        {
          runtimeId: 'dp_project_production',
          service: 'web',
          observedAt: new Date().toISOString(),
          content: 'ÄPI ready',
        },
      ],
    })
    const stored = await logsDb
      .select()
      .from(runtimeLogs)
      .where(eq(runtimeLogs.serverId, serverId))
    touchedRuntimeLogIds.push(...stored.map((row) => row.id))
    expect(stored[0]).toMatchObject({ projectId, searchContent: 'äpi ready' })
    const context = { userId, teamSlug, projectName }
    expect(
      (await getProjectLogsSectionContext({ ...context, keyword: 'äpi' })).logs,
    ).toHaveLength(1)
    expect(
      (await getProjectLogsSectionContext({ ...context, branch: 'another' }))
        .logs,
    ).toHaveLength(0)
    await expect(
      getProjectLogsSectionContext({ ...context, userId: 'outsider' }),
    ).rejects.toThrow()
    await db
      .update(environments)
      .set({ branch: 'renamed' })
      .where(eq(environments.projectId, projectId))
    expect(
      (await getProjectLogsSectionContext({ ...context, branch: 'main' })).logs,
    ).toHaveLength(0)
    expect(
      (await getProjectLogsSectionContext({ ...context, branch: 'renamed' }))
        .logs,
    ).toHaveLength(1)
    // Removing the current server assignment makes previously captured output
    // inaccessible even though its denormalized identity remains in log storage.
    await db
      .update(environments)
      .set({ serverId: null })
      .where(eq(environments.projectId, projectId))
    const unassigned = await getProjectLogsSectionContext(context)
    expect(unassigned.logs).toHaveLength(0)
    expect(unassigned.hasAnyLogs).toBe(false)
  })

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

    expect(await recordRuntimeLogs(payload)).toEqual({
      ok: true,
      accepted: 1,
      inserted: 1,
    })
    expect(await recordRuntimeLogs(payload)).toEqual({
      ok: true,
      accepted: 1,
      inserted: 0,
    })

    const rows = await logsDb
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

    const context = await getProjectLogsSectionContext({
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
    const { projectId, environmentId, serverId, token } = await createFixture()
    const oldObservedAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const currentObservedAt = new Date()
    const oldLogId = `runtime-log-${crypto.randomUUID()}`

    touchedRuntimeLogIds.push(oldLogId)
    await logsDb.insert(runtimeLogs).values({
      id: oldLogId,
      projectId,
      environmentId,
      searchContent: 'old runtime line',
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

    const rows = await logsDb
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

    const rows = await logsDb
      .select({ id: runtimeLogs.id, content: runtimeLogs.content })
      .from(runtimeLogs)
      .where(eq(runtimeLogs.serverId, serverId))
    touchedRuntimeLogIds.push(...rows.map((row) => row.id))

    expect(rows).toEqual([
      { id: expect.any(String), content: 'Inherited server log' },
    ])

    const context = await getProjectLogsSectionContext({
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

    const rows = await logsDb
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
    environmentId,
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
    await logsDb
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
