import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import {
  agentJobs,
  agentRuntimeObservations,
  environments,
  projects,
  servers,
  teams,
  user,
} from '@/server/db/schema'
import { reconcileReportedRuntimes } from './reconciliation'

const touchedObservationIds: Array<string> = []
const touchedJobIds: Array<string> = []
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

describe('agent runtime reconciliation', () => {
  test('drains retained orphan volumes in bounded jobs across heartbeats', async () => {
    const { serverId } = await createFixture()
    const now = new Date()
    const old = new Date(now.getTime() - 8 * 24 * 60 * 60_000)
    const rows = Array.from({ length: 251 }, (_, index) => ({
      id: crypto.randomUUID(),
      serverId,
      runtimeId: `dp_retained_${index.toString().padStart(3, '0')}`,
      firstSeenAt: old,
      lastSeenAt: old,
      cleanupQueuedAt: old,
    }))
    touchedObservationIds.push(...rows.map((row) => row.id))
    await db.insert(agentRuntimeObservations).values(rows)
    const first = await reconcileReportedRuntimes({
      serverId,
      runtimeIds: [],
      now,
    })
    const second = await reconcileReportedRuntimes({
      serverId,
      runtimeIds: [],
      now,
    })
    expect(first).toHaveLength(200)
    expect(second).toHaveLength(51)
    expect(new Set([...first, ...second]).size).toBe(251)
    expect(
      await reconcileReportedRuntimes({ serverId, runtimeIds: [], now }),
    ).toEqual([])
    const jobs = await db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.serverId, serverId))
    touchedJobIds.push(...jobs.map((job) => job.id))
    expect(jobs).toHaveLength(2)
    expect(jobs.every((job) => job.type === 'purge')).toBe(true)
  })

  test('stores the latest Compose service state for an observed runtime', async () => {
    const { serverId } = await createFixture()
    const services = [
      {
        name: 'web',
        containerName: 'project-web-1',
        state: 'running',
        health: 'healthy',
        restartCount: 1,
        startedAt: '2026-06-01T00:00:00Z',
        exitCode: 0,
      },
    ]

    await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_production'],
      runtimes: [{ runtimeId: 'dp_project_production', services }],
      now: new Date('2026-06-01T00:01:00Z'),
    })

    const observations = await db
      .select({
        id: agentRuntimeObservations.id,
        services: agentRuntimeObservations.services,
      })
      .from(agentRuntimeObservations)
      .where(eq(agentRuntimeObservations.serverId, serverId))
    touchedObservationIds.push(...observations.map((row) => row.id))

    expect(observations.at(0)?.services).toEqual(services)
  })

  test('records first sighting without queueing cleanup', async () => {
    const { serverId } = await createFixture()

    const queued = await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_orphan'],
      now: new Date('2026-06-01T00:00:00Z'),
    })

    const observations = await db
      .select({
        id: agentRuntimeObservations.id,
        runtimeId: agentRuntimeObservations.runtimeId,
        cleanupQueuedAt: agentRuntimeObservations.cleanupQueuedAt,
      })
      .from(agentRuntimeObservations)
      .where(eq(agentRuntimeObservations.serverId, serverId))
    touchedObservationIds.push(...observations.map((row) => row.id))

    const jobs = await db
      .select({ id: agentJobs.id })
      .from(agentJobs)
      .where(eq(agentJobs.serverId, serverId))

    expect(queued).toEqual([])
    expect(observations).toMatchObject([
      { runtimeId: 'dp_project_orphan', cleanupQueuedAt: null },
    ])
    expect(jobs).toEqual([])
  })

  test('queues deprovision only for a grace-confirmed orphan runtime', async () => {
    const { serverId } = await createFixture()

    await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_orphan'],
      now: new Date('2026-06-01T00:00:00Z'),
    })

    const queued = await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_orphan'],
      now: new Date('2026-06-01T00:11:00Z'),
    })

    const observations = await db
      .select({
        id: agentRuntimeObservations.id,
        cleanupQueuedAt: agentRuntimeObservations.cleanupQueuedAt,
      })
      .from(agentRuntimeObservations)
      .where(eq(agentRuntimeObservations.serverId, serverId))
    touchedObservationIds.push(...observations.map((row) => row.id))

    const jobs = await db
      .select({
        id: agentJobs.id,
        type: agentJobs.type,
        payload: agentJobs.payload,
      })
      .from(agentJobs)
      .where(eq(agentJobs.serverId, serverId))
    touchedJobIds.push(...jobs.map((row) => row.id))

    expect(queued).toEqual(['dp_project_orphan'])
    expect(observations.at(0)?.cleanupQueuedAt).toBeInstanceOf(Date)
    expect(jobs).toHaveLength(1)
    expect(jobs.at(0)).toMatchObject({
      type: 'deprovision',
      payload: {
        runtimeIds: ['dp_project_orphan'],
        removeVolumes: false,
      },
    })
  })

  test('queues retained-volume purge after orphan cleanup retention', async () => {
    const { serverId } = await createFixture()

    await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_orphan'],
      now: new Date('2026-06-01T00:00:00Z'),
    })
    await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_orphan'],
      now: new Date('2026-06-01T00:11:00Z'),
    })

    let jobs = await db
      .select({
        id: agentJobs.id,
        type: agentJobs.type,
      })
      .from(agentJobs)
      .where(eq(agentJobs.serverId, serverId))
    touchedJobIds.push(...jobs.map((row) => row.id))

    const beforeRetention = await reconcileReportedRuntimes({
      serverId,
      runtimeIds: [],
      now: new Date('2026-06-07T00:11:00Z'),
    })

    expect(beforeRetention).toEqual([])

    await db
      .update(agentJobs)
      .set({
        status: 'succeeded',
        finishedAt: new Date('2026-06-01T00:12:00Z'),
      })
      .where(eq(agentJobs.id, jobs.at(0)?.id ?? 'missing'))

    const queued = await reconcileReportedRuntimes({
      serverId,
      runtimeIds: [],
      now: new Date('2026-06-08T00:11:00Z'),
    })

    const observations = await db
      .select({
        id: agentRuntimeObservations.id,
        purgeQueuedAt: agentRuntimeObservations.purgeQueuedAt,
      })
      .from(agentRuntimeObservations)
      .where(eq(agentRuntimeObservations.serverId, serverId))
    touchedObservationIds.push(...observations.map((row) => row.id))

    jobs = await db
      .select({
        id: agentJobs.id,
        type: agentJobs.type,
        payload: agentJobs.payload,
      })
      .from(agentJobs)
      .where(eq(agentJobs.serverId, serverId))
    touchedJobIds.push(
      ...jobs.map((row) => row.id).filter((id) => !touchedJobIds.includes(id)),
    )

    expect(queued).toEqual(['dp_project_orphan'])
    expect(observations.at(0)?.purgeQueuedAt).toBeInstanceOf(Date)
    expect(jobs).toHaveLength(2)
    expect(jobs.map((job) => job.type).sort()).toEqual(['deprovision', 'purge'])
    expect(jobs.find((job) => job.type === 'purge')).toMatchObject({
      type: 'purge',
      payload: {
        runtimeIds: ['dp_project_orphan'],
        removeVolumes: true,
      },
    })
  })

  test('does not queue cleanup for an active environment runtime', async () => {
    const { projectId, serverId } = await createFixture()
    const environmentId = `env-${crypto.randomUUID()}`
    touchedEnvironmentIds.push(environmentId)
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

    await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_production'],
      now: new Date('2026-06-01T00:00:00Z'),
    })
    const queued = await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_production'],
      now: new Date('2026-06-01T00:11:00Z'),
    })

    const observations = await db
      .select({ id: agentRuntimeObservations.id })
      .from(agentRuntimeObservations)
      .where(eq(agentRuntimeObservations.serverId, serverId))
    touchedObservationIds.push(...observations.map((row) => row.id))

    const jobs = await db
      .select({ id: agentJobs.id })
      .from(agentJobs)
      .where(eq(agentJobs.serverId, serverId))

    expect(queued).toEqual([])
    expect(jobs).toEqual([])
  })

  test('does not clean up a runtime inheriting the project server', async () => {
    const { projectId, serverId } = await createFixture()
    const environmentId = `env-${crypto.randomUUID()}`
    touchedEnvironmentIds.push(environmentId)
    await db
      .update(projects)
      .set({ defaultServerId: serverId })
      .where(eq(projects.id, projectId))
    await db.insert(environments).values({
      id: environmentId,
      projectId,
      serverId: null,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      isProduction: true,
      runtimeId: 'dp_project_production',
    })

    await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_production'],
      now: new Date('2026-06-01T00:00:00Z'),
    })
    const queued = await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_production'],
      now: new Date('2026-06-01T00:11:00Z'),
    })

    const observations = await db
      .select({ id: agentRuntimeObservations.id })
      .from(agentRuntimeObservations)
      .where(eq(agentRuntimeObservations.serverId, serverId))
    touchedObservationIds.push(...observations.map((row) => row.id))
    const jobs = await db
      .select({ id: agentJobs.id })
      .from(agentJobs)
      .where(eq(agentJobs.serverId, serverId))

    expect(queued).toEqual([])
    expect(jobs).toEqual([])
  })

  test('keeps a runtime intentionally left behind with a deleted project', async () => {
    const { projectId, serverId } = await createFixture()
    const environmentId = `env-${crypto.randomUUID()}`
    touchedEnvironmentIds.push(environmentId)
    await db
      .update(projects)
      .set({ defaultServerId: serverId })
      .where(eq(projects.id, projectId))
    await db.insert(environments).values({
      id: environmentId,
      projectId,
      serverId: null,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      isProduction: true,
      runtimeId: 'dp_project_production',
    })

    await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_production'],
      now: new Date('2026-06-01T00:00:00Z'),
    })
    await db
      .update(projects)
      .set({ status: 'deleted' })
      .where(eq(projects.id, projectId))
    const queued = await reconcileReportedRuntimes({
      serverId,
      runtimeIds: ['dp_project_production'],
      now: new Date('2026-06-01T00:11:00Z'),
    })

    const observations = await db
      .select({ id: agentRuntimeObservations.id })
      .from(agentRuntimeObservations)
      .where(eq(agentRuntimeObservations.serverId, serverId))
    touchedObservationIds.push(...observations.map((row) => row.id))
    const jobs = await db
      .select({ id: agentJobs.id, type: agentJobs.type })
      .from(agentJobs)
      .where(eq(agentJobs.serverId, serverId))
    touchedJobIds.push(...jobs.map((row) => row.id))

    expect(queued).toEqual([])
    expect(jobs).toEqual([])
  })
})

async function createFixture() {
  const suffix = crypto.randomUUID()
  const userId = `user-${suffix}`
  const teamId = `team-${suffix}`
  const serverId = `server-${suffix}`
  const projectId = `project-${suffix}`

  touchedUserIds.push(userId)
  touchedTeamIds.push(teamId)
  touchedServerIds.push(serverId)
  touchedProjectIds.push(projectId)

  await db.insert(user).values({
    id: userId,
    name: 'Test User',
    username: `user-${suffix.slice(0, 12)}`,
    email: `user-${suffix}@example.com`,
    emailVerified: true,
  })
  await db.insert(teams).values({
    id: teamId,
    slug: `team-${suffix}`,
    name: 'Test Team',
  })
  await db.insert(servers).values({
    id: serverId,
    teamId,
    name: `server-${suffix}`,
    handle: `server-${suffix}`,
    status: 'connected',
  })
  await db.insert(projects).values({
    id: projectId,
    teamId,
    slug: `project-${suffix}`,
    name: 'Test Project',
    githubRepo: 'acme/app',
  })

  return { projectId, serverId }
}

async function cleanupRows() {
  if (touchedJobIds.length > 0) {
    await db.delete(agentJobs).where(inArray(agentJobs.id, touchedJobIds))
    touchedJobIds.length = 0
  }

  if (touchedObservationIds.length > 0) {
    await db
      .delete(agentRuntimeObservations)
      .where(inArray(agentRuntimeObservations.id, touchedObservationIds))
    touchedObservationIds.length = 0
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
    await db.delete(teams).where(inArray(teams.id, touchedTeamIds))
    touchedTeamIds.length = 0
  }

  if (touchedUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, touchedUserIds))
    touchedUserIds.length = 0
  }
}
