import { recordServerMetrics } from '#devpush/test/server-metrics'
import { createClient } from '@libsql/client'
import { migrateLibsql } from '#devpush/server/db/migrate-libsql'
import { openLibsql } from '#devpush/server/db/libsql-connection'
import * as metricDbSchema from '#devpush/server/db/schema'
import { fileURLToPath } from 'node:url'
import { recordAgentMetricSamples, metricRowId } from './metric-history'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '#devpush/server/db'
import {
  serverHeartbeats,
  serverMetrics,
  servers,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'
import {
  listServerMetricSeries,
  listServerMonitoringSummaries,
  recordServerHeartbeat,
  pruneServerMonitoring,
} from '#devpush/server/servers/monitoring'

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
  test('stores idempotent metric batches through libSQL', async () => {
    const client = createClient({ url: ':memory:' })
    try {
      await migrateLibsql(
        client,
        fileURLToPath(new URL('../db/migrations-sqlite/', import.meta.url)),
      )
      const store = openLibsql(client, metricDbSchema).db
      await store
        .insert(teams)
        .values({ id: 'metric-team', slug: 'metric-team', name: 'Metric team' })
      await store.insert(servers).values({
        id: 'metric-server',
        teamId: 'metric-team',
        name: 'Metric server',
        handle: 'metric-server',
      })
      const now = new Date()
      const samples = Array.from({ length: 240 }, (_, index) => ({
        id: index.toString(16).padStart(32, '0'),
        observedAt: now.toISOString(),
        metrics: { cpuPercent: 1 },
      }))
      expect(
        await recordAgentMetricSamples('metric-server', samples, now, store),
      ).toBe(samples.at(-1)?.id)
      await recordAgentMetricSamples('metric-server', samples, now, store)
      expect(await store.select().from(serverMetrics)).toHaveLength(240)
    } finally {
      client.close()
    }
  })

  test('replays original timestamps idempotently and repairs holes', async () => {
    const { serverId } = await createFixture()
    const now = new Date()
    const samples = Array.from({ length: 240 }, (_, index) => ({
      id: index.toString(16).padStart(32, '0'),
      observedAt: new Date(
        now.getTime() - (240 - index) * 30_000,
      ).toISOString(),
      metrics: { cpuPercent: index % 100, memoryUsedBytes: 1024 },
    }))
    touchedMetricIds.push(
      ...samples.map((sample) => metricRowId(serverId, sample.id)),
    )
    expect(await recordAgentMetricSamples(serverId, samples, now)).toBe(
      samples.at(-1)?.id,
    )
    await recordAgentMetricSamples(serverId, samples, now)
    let rows = await db
      .select()
      .from(serverMetrics)
      .where(eq(serverMetrics.serverId, serverId))
    expect(rows).toHaveLength(240)
    expect(
      rows
        .find((row) => row.id === metricRowId(serverId, samples[0]!.id))
        ?.observedAt.toISOString(),
    ).toBe(samples[0]!.observedAt)
    await db
      .delete(serverMetrics)
      .where(eq(serverMetrics.id, metricRowId(serverId, samples[10]!.id)))
    await recordAgentMetricSamples(serverId, samples, now)
    rows = await db
      .select()
      .from(serverMetrics)
      .where(eq(serverMetrics.serverId, serverId))
    expect(rows).toHaveLength(240)
    expect(metricRowId('different-server', samples[0]!.id)).not.toBe(
      metricRowId(serverId, samples[0]!.id),
    )
    expect(await recordAgentMetricSamples(serverId, [], now)).toBeUndefined()
    await expect(
      recordAgentMetricSamples('nonexistent-server', samples, now),
    ).rejects.toThrow()
    // Expired backlog is acknowledged without recreating purged records.
    expect(
      await recordAgentMetricSamples(
        serverId,
        [
          {
            ...samples[0]!,
            id: 'f'.repeat(32),
            observedAt: '1900-01-01T00:00:00.000Z',
          },
        ],
        now,
      ),
    ).toBe('f'.repeat(32))
    expect(
      await db
        .select()
        .from(serverMetrics)
        .where(eq(serverMetrics.id, metricRowId(serverId, 'f'.repeat(32)))),
    ).toHaveLength(0)
  })

  test('prunes expired samples across batches while preserving the retention boundary', async () => {
    const { serverId } = await createFixture()
    const old = new Date('1900-01-01T00:00:00Z')
    const boundary = new Date('1900-01-03T00:00:00Z')
    const fresh = new Date('1900-01-09T00:00:00Z')
    const heartbeatRows = Array.from({ length: 1005 }, () => ({
      id: crypto.randomUUID(),
      serverId,
      observedAt: old,
    }))
    const keptHeartbeats = [boundary, fresh].map((observedAt) => ({
      id: crypto.randomUUID(),
      serverId,
      observedAt,
    }))
    const metricRows = [old, boundary, fresh].map((observedAt) => ({
      id: crypto.randomUUID(),
      serverId,
      observedAt,
      cpuPercent: 10,
    }))
    touchedHeartbeatIds.push(
      ...heartbeatRows.map((row) => row.id),
      ...keptHeartbeats.map((row) => row.id),
    )
    touchedMetricIds.push(...metricRows.map((row) => row.id))
    for (let start = 0; start < heartbeatRows.length; start += 100) {
      await db
        .insert(serverHeartbeats)
        .values(heartbeatRows.slice(start, start + 100))
    }
    await db.insert(serverHeartbeats).values(keptHeartbeats)
    await db.insert(serverMetrics).values(metricRows)
    const result = await pruneServerMonitoring(new Date('1900-01-10T00:00:00Z'))
    expect(result).toEqual({ heartbeats: 1005, metrics: 1 })
    expect(
      (
        await db
          .select()
          .from(serverHeartbeats)
          .where(eq(serverHeartbeats.serverId, serverId))
      )
        .map((row) => row.id)
        .sort(),
    ).toEqual(keptHeartbeats.map((row) => row.id).sort())
    expect(
      (
        await db
          .select()
          .from(serverMetrics)
          .where(eq(serverMetrics.serverId, serverId))
      )
        .map((row) => row.id)
        .sort(),
    ).toEqual(
      metricRows
        .slice(1)
        .map((row) => row.id)
        .sort(),
    )
  })
  test('records heartbeat history and returns availability summaries', async () => {
    const { serverId } = await createFixture()
    const now = new Date('2026-06-28T10:00:00.000Z')

    await recordServerHeartbeat({
      serverId,
      observedAt: new Date('2026-06-28T09:56:00.000Z'),
      agentVersion: 'devpush-agent/1.0.0',
      publicAddress: '203.0.113.10',
    })
    await recordServerHeartbeat({
      serverId,
      observedAt: new Date('2026-06-28T09:57:00.000Z'),
      agentVersion: 'devpush-agent/1.0.0',
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
