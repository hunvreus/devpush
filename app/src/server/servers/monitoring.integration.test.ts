import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import {
  serverHeartbeats,
  serverMetrics,
  servers,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import {
  listServerMetricSeries,
  listServerMonitoringSummaries,
  recordServerHeartbeat,
  recordServerMetrics,
} from '@/server/servers/monitoring'

const touchedHeartbeatIds: Array<string> = []
const touchedMetricIds: Array<string> = []
const touchedServerIds: Array<string> = []
const touchedTeamIds: Array<string> = []
const touchedUserIds: Array<string> = []

afterEach(async () => {
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('server monitoring integration', () => {
  test('records heartbeat history and returns availability summaries', async () => {
    const { serverId } = await createFixture()
    const now = new Date('2026-06-28T10:00:00.000Z')

    await recordServerHeartbeat({
      serverId,
      observedAt: new Date('2026-06-28T09:56:00.000Z'),
      agentVersion: 'devpush-agent/0.1.0',
      publicAddress: '203.0.113.10',
    })
    await recordServerHeartbeat({
      serverId,
      observedAt: new Date('2026-06-28T09:57:00.000Z'),
      agentVersion: 'devpush-agent/0.1.0',
      publicAddress: '203.0.113.10',
    })

    const heartbeatRows = await db
      .select({ id: serverHeartbeats.id })
      .from(serverHeartbeats)
      .where(eq(serverHeartbeats.serverId, serverId))
    touchedHeartbeatIds.push(...heartbeatRows.map((row) => row.id))

    const summaries = await listServerMonitoringSummaries(
      [{ id: serverId, createdAt: new Date('2026-06-28T09:56:00.000Z') }],
      now,
    )

    const summary = summaries.get(serverId)

    expect(summary?.availabilityPercent).toBeCloseTo(75)
    expect(summary?.availabilityWindowMs).toBe(4 * 60_000)
  })

  test('records latest host metrics in monitoring summaries', async () => {
    const { serverId } = await createFixture()
    const now = new Date('2026-06-28T10:00:00.000Z')

    await recordServerMetrics({
      serverId,
      observedAt: new Date('2026-06-28T09:59:00.000Z'),
      metrics: {
        cpuPercent: 12.5,
        memoryUsedBytes: 1024,
        memoryTotalBytes: 4096,
        diskUsedBytes: 2048,
        diskTotalBytes: 8192,
        networkReceiveBytesPerSecond: 512,
        networkTransmitBytesPerSecond: 256,
        diskReadBytesPerSecond: 128,
        diskWriteBytesPerSecond: 64,
      },
    })

    const metricRows = await db
      .select({ id: serverMetrics.id })
      .from(serverMetrics)
      .where(eq(serverMetrics.serverId, serverId))
    touchedMetricIds.push(...metricRows.map((row) => row.id))

    const summaries = await listServerMonitoringSummaries(
      [{ id: serverId, createdAt: new Date('2026-06-28T09:56:00.000Z') }],
      now,
    )

    expect(summaries.get(serverId)?.latestMetrics).toEqual({
      observedAt: '2026-06-28T09:59:00.000Z',
      cpuPercent: 12.5,
      load1: null,
      memoryUsedBytes: 1024,
      memoryTotalBytes: 4096,
      diskUsedBytes: 2048,
      diskTotalBytes: 8192,
      networkReceiveBytesPerSecond: 512,
      networkTransmitBytesPerSecond: 256,
      diskReadBytesPerSecond: 128,
      diskWriteBytesPerSecond: 64,
    })
  })

  test('returns host metric history ordered oldest to newest', async () => {
    const { serverId } = await createFixture()
    const now = new Date('2026-06-28T10:00:00.000Z')

    await recordServerMetrics({
      serverId,
      observedAt: new Date('2026-06-27T09:59:00.000Z'),
      metrics: {
        cpuPercent: 99,
      },
    })
    await recordServerMetrics({
      serverId,
      observedAt: new Date('2026-06-28T09:58:00.000Z'),
      metrics: {
        cpuPercent: 10,
      },
    })
    await recordServerMetrics({
      serverId,
      observedAt: new Date('2026-06-28T09:59:00.000Z'),
      metrics: {
        cpuPercent: 20,
      },
    })

    const metricRows = await db
      .select({ id: serverMetrics.id })
      .from(serverMetrics)
      .where(eq(serverMetrics.serverId, serverId))
    touchedMetricIds.push(...metricRows.map((row) => row.id))

    const series = await listServerMetricSeries({ serverId, now })

    expect(series.map((sample) => sample.observedAt)).toEqual([
      '2026-06-28T09:58:00.000Z',
      '2026-06-28T09:59:00.000Z',
    ])
    expect(series.map((sample) => sample.cpuPercent)).toEqual([10, 20])
  })
})

async function createFixture() {
  const suffix = crypto.randomUUID()
  const userId = `user-${suffix}`
  const teamId = `team-${suffix}`
  const serverId = `server-${suffix}`

  touchedUserIds.push(userId)
  touchedTeamIds.push(teamId)
  touchedServerIds.push(serverId)

  await db.insert(user).values({
    id: userId,
    name: 'Monitoring User',
    username: `monitor-${suffix.slice(0, 12)}`,
    email: `monitor-${suffix}@example.com`,
    emailVerified: true,
  })
  await db.insert(teams).values({
    id: teamId,
    slug: `team-${suffix}`,
    name: 'Monitoring Team',
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
    createdAt: new Date('2026-06-28T09:56:00.000Z'),
  })

  return { serverId }
}

async function cleanupRows() {
  if (touchedHeartbeatIds.length > 0) {
    await db
      .delete(serverHeartbeats)
      .where(inArray(serverHeartbeats.id, touchedHeartbeatIds))
    touchedHeartbeatIds.length = 0
  }

  if (touchedMetricIds.length > 0) {
    await db
      .delete(serverMetrics)
      .where(inArray(serverMetrics.id, touchedMetricIds))
    touchedMetricIds.length = 0
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
