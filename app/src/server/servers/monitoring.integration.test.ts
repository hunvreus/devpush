import { recordServerMetrics } from '#devpush/test/server-metrics'
import { createClient } from '@libsql/client'
import { migrateLibsql } from '#devpush/server/db/migrate-libsql'
import { createD1TestStores } from '#devpush/test/d1'
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
  calculateHeartbeatAvailability,
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
  test('compressed spans match raw heartbeat availability across varied gaps and disabled periods', async () => {
    const { serverId } = await createFixture()
    let time = Date.parse('2026-06-01T00:00:00Z')
    let seed = 17
    const raw = []
    const gaps = [15_000, 30_000, 60_000, 120_000, 150_000, 300_000]
    for (let index = 0; index < 100; index++) {
      seed = (seed * 16807) % 2147483647
      time += gaps[seed % gaps.length]!
      const observedAt = new Date(time)
      raw.push({ observedAt })
      await recordServerHeartbeat({
        serverId,
        observedAt,
        agentVersion: 'test',
        publicAddress: null,
      })
    }
    const spans = await db
      .select()
      .from(serverHeartbeats)
      .where(eq(serverHeartbeats.serverId, serverId))
    touchedHeartbeatIds.push(...spans.map((row) => row.id))
    const input = {
      availabilityWindows: [
        { startedAt: raw[0]!.observedAt, endedAt: raw[30]!.observedAt },
        { startedAt: raw[45]!.observedAt, endedAt: null },
      ],
      now: new Date(time + 90_000),
    }
    expect(
      calculateHeartbeatAvailability({ ...input, heartbeats: spans }),
    ).toEqual(calculateHeartbeatAvailability({ ...input, heartbeats: raw }))
  })

  test('D1 extends migrated heartbeat rows and preserves the original availability', async () => {
    const fixture = await createD1TestStores()
    try {
      const store = fixture.main
      await store
        .insert(teams)
        .values({ id: 'span-team', name: 'Team', slug: 'span-team' })
      await store.insert(servers).values({
        id: 'span-server',
        teamId: 'span-team',
        name: 'Server',
        handle: 'server',
      })
      const start = Date.parse('2026-06-01T00:00:00Z')
      await store.insert(serverHeartbeats).values({
        id: 'old-row',
        serverId: 'span-server',
        observedAt: new Date(start),
      })
      for (let offset = 30_000; offset <= 600_000; offset += 30_000)
        await recordServerHeartbeat(
          {
            serverId: 'span-server',
            observedAt: new Date(start + offset),
            agentVersion: 'test',
            publicAddress: null,
          },
          store,
        )
      const rows = await store.select().from(serverHeartbeats)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe('old-row')
      expect(rows[0]?.lastObservedAt?.getTime()).toBe(start + 600_000)
    } finally {
      await fixture.runtime.dispose()
    }
  })

  test('concurrent reports preserve a single span and its earliest/latest times', async () => {
    const { serverId } = await createFixture()
    const start = Date.parse('2026-06-01T00:00:00Z')
    await Promise.all(
      [1000, 0, 2000, 500, 1500].map((offset) =>
        recordServerHeartbeat({
          serverId,
          observedAt: new Date(start + offset),
          agentVersion: 'test',
          publicAddress: null,
        }),
      ),
    )
    const spans = await db
      .select()
      .from(serverHeartbeats)
      .where(eq(serverHeartbeats.serverId, serverId))
    touchedHeartbeatIds.push(...spans.map((row) => row.id))
    expect(spans).toHaveLength(1)
    expect(spans[0]?.observedAt.getTime()).toBe(start)
    expect(spans[0]?.lastObservedAt?.getTime()).toBe(start + 2000)
  })

  test('compacts connected reports, preserves gaps and retains active spans past the retention cutoff', async () => {
    const { serverId } = await createFixture()
    const start = new Date('2026-06-01T00:00:00Z')
    const beat = (offset: number) =>
      recordServerHeartbeat({
        serverId,
        observedAt: new Date(start.getTime() + offset),
        agentVersion: 'test',
        publicAddress: '192.0.2.1',
      })
    for (let offset = 0; offset <= 600_000; offset += 30_000) await beat(offset)
    let spans = await db
      .select()
      .from(serverHeartbeats)
      .where(eq(serverHeartbeats.serverId, serverId))
    expect(spans).toHaveLength(1)
    expect(spans[0]?.lastObservedAt).toEqual(
      new Date(start.getTime() + 600_000),
    )
    await beat(590_000)
    await beat(900_000)
    spans = await db
      .select()
      .from(serverHeartbeats)
      .where(eq(serverHeartbeats.serverId, serverId))
    touchedHeartbeatIds.push(...spans.map((row) => row.id))
    expect(spans).toHaveLength(2)
    expect(
      spans.find((row) => row.observedAt.getTime() === start.getTime())
        ?.lastObservedAt,
    ).toEqual(new Date(start.getTime() + 600_000))
    const summary = await listServerMonitoringSummaries(
      [{ id: serverId, createdAt: start }],
      new Date(start.getTime() + 960_000),
    )
    expect(summary.get(serverId)?.availabilityPercent).toBeCloseTo(81.25)
    // Model a continuously refreshed span that began more than seven days ago.
    const fresh = new Date('2026-06-10T00:00:00Z')
    await db
      .update(serverHeartbeats)
      .set({ lastObservedAt: fresh })
      .where(eq(serverHeartbeats.id, spans[0]!.id))
    await pruneServerMonitoring(fresh)
    const retained = await db
      .select()
      .from(serverHeartbeats)
      .where(eq(serverHeartbeats.serverId, serverId))
    expect(retained).toHaveLength(1)
    const current = await listServerMonitoringSummaries(
      [{ id: serverId, createdAt: start }],
      fresh,
    )
    expect(current.get(serverId)?.availabilityPercent).toBe(100)
  })

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

  test('calculates heartbeat availability independently for each server', async () => {
    const first = await createFixture()
    const second = await createFixture()
    const now = new Date('2026-06-28T10:00:00.000Z')
    const createdAt = new Date('2026-06-28T09:56:00.000Z')
    for (const [serverId, observedAt] of [
      [first.serverId, '2026-06-28T09:56:00.000Z'],
      [first.serverId, '2026-06-28T09:57:00.000Z'],
      [second.serverId, '2026-06-28T09:59:00.000Z'],
    ]) {
      await recordServerHeartbeat({
        serverId: serverId!,
        observedAt: new Date(observedAt!),
        agentVersion: null,
        publicAddress: null,
      })
    }
    const summaries = await listServerMonitoringSummaries(
      [first, second].map(({ serverId }) => ({ id: serverId, createdAt })),
      now,
    )
    expect(summaries.get(first.serverId)?.availabilityPercent).toBeCloseTo(75)
    expect(summaries.get(second.serverId)?.availabilityPercent).toBeCloseTo(25)
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
    expect(series[0]?.memoryUsedBytes).toBeNull()
    const limited = await listServerMetricSeries({ serverId, now, limit: 1 })
    expect(limited).toHaveLength(1)
    expect(limited[0]?.observedAt).toBe('2026-06-28T09:59:00.000Z')
    expect(limited[0]?.cpuPercent).toBe(20)
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
