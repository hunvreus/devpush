import { randomUUID } from 'node:crypto'

import { and, desc, eq, gte, inArray } from 'drizzle-orm'

import { db } from '@/server/db'
import { serverHeartbeats, serverMetrics } from '@/server/db/schema'
import { serverDisconnectedAfterMs } from '@/server/servers/status'

const uptimeWindowMs = 24 * 60 * 60 * 1000
const metricsWindowMs = 24 * 60 * 60 * 1000
const defaultMetricsLimit = 240

export type ServerMonitoringSummary = {
  heartbeatCount24h: number
  uptime24h: number | null
  latestMetrics: ServerMetricsSample | null
}

export type ServerMetricsInput = {
  cpuPercent?: number
  load1?: number
  memoryUsedBytes?: number
  memoryTotalBytes?: number
  diskUsedBytes?: number
  diskTotalBytes?: number
}

export type ServerMetricsSample = {
  observedAt: string
  cpuPercent: number | null
  load1: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  diskUsedBytes: number | null
  diskTotalBytes: number | null
}

type ServerWindow = {
  id: string
  createdAt: Date
}

type HeartbeatRow = {
  serverId: string
  observedAt: Date
}

export async function recordServerHeartbeat({
  serverId,
  observedAt,
  agentVersion,
  publicAddress,
}: {
  serverId: string
  observedAt: Date
  agentVersion: string | null
  publicAddress: string | null
}) {
  await db.insert(serverHeartbeats).values({
    id: randomUUID(),
    serverId,
    observedAt,
    agentVersion,
    publicAddress,
  })
}

export async function recordServerMetrics({
  serverId,
  observedAt,
  metrics,
}: {
  serverId: string
  observedAt: Date
  metrics: ServerMetricsInput
}) {
  if (!hasMetrics(metrics)) {
    return
  }

  await db.insert(serverMetrics).values({
    id: randomUUID(),
    serverId,
    observedAt,
    cpuPercent: metrics.cpuPercent ?? null,
    load1: metrics.load1 ?? null,
    memoryUsedBytes: metrics.memoryUsedBytes ?? null,
    memoryTotalBytes: metrics.memoryTotalBytes ?? null,
    diskUsedBytes: metrics.diskUsedBytes ?? null,
    diskTotalBytes: metrics.diskTotalBytes ?? null,
  })
}

export async function listServerMonitoringSummaries(
  servers: Array<ServerWindow>,
  now = new Date(),
): Promise<Map<string, ServerMonitoringSummary>> {
  const serverIds = servers.map((server) => server.id)
  const summaries = new Map<string, ServerMonitoringSummary>()

  for (const server of servers) {
    summaries.set(server.id, {
      heartbeatCount24h: 0,
      uptime24h: null,
      latestMetrics: null,
    })
  }

  if (serverIds.length === 0) {
    return summaries
  }

  const heartbeatRows = await db
    .select({
      serverId: serverHeartbeats.serverId,
      observedAt: serverHeartbeats.observedAt,
    })
    .from(serverHeartbeats)
    .where(
      and(
        inArray(serverHeartbeats.serverId, serverIds),
        gte(
          serverHeartbeats.observedAt,
          new Date(now.getTime() - uptimeWindowMs),
        ),
      ),
    )

  const latestMetricRows = await Promise.all(
    serverIds.map(async (serverId) => {
      const rows = await db
        .select({
          serverId: serverMetrics.serverId,
          observedAt: serverMetrics.observedAt,
          cpuPercent: serverMetrics.cpuPercent,
          load1: serverMetrics.load1,
          memoryUsedBytes: serverMetrics.memoryUsedBytes,
          memoryTotalBytes: serverMetrics.memoryTotalBytes,
          diskUsedBytes: serverMetrics.diskUsedBytes,
          diskTotalBytes: serverMetrics.diskTotalBytes,
        })
        .from(serverMetrics)
        .where(eq(serverMetrics.serverId, serverId))
        .orderBy(desc(serverMetrics.observedAt))
        .limit(1)

      return rows.at(0) ?? null
    }),
  )
  const latestMetrics = new Map(
    latestMetricRows
      .filter((row) => row !== null)
      .map((row) => [row.serverId, formatMetricSample(row)]),
  )

  for (const server of servers) {
    const heartbeats = heartbeatRows
      .filter((row) => row.serverId === server.id)
      .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())

    summaries.set(server.id, {
      heartbeatCount24h: heartbeats.length,
      uptime24h: calculateHeartbeatUptime({
        createdAt: server.createdAt,
        heartbeats,
        now,
      }),
      latestMetrics: latestMetrics.get(server.id) ?? null,
    })
  }

  return summaries
}

export async function listServerMetricSeries({
  serverId,
  now = new Date(),
  limit = defaultMetricsLimit,
}: {
  serverId: string
  now?: Date
  limit?: number
}): Promise<Array<ServerMetricsSample>> {
  const rows = await db
    .select({
      observedAt: serverMetrics.observedAt,
      cpuPercent: serverMetrics.cpuPercent,
      load1: serverMetrics.load1,
      memoryUsedBytes: serverMetrics.memoryUsedBytes,
      memoryTotalBytes: serverMetrics.memoryTotalBytes,
      diskUsedBytes: serverMetrics.diskUsedBytes,
      diskTotalBytes: serverMetrics.diskTotalBytes,
    })
    .from(serverMetrics)
    .where(
      and(
        eq(serverMetrics.serverId, serverId),
        gte(
          serverMetrics.observedAt,
          new Date(now.getTime() - metricsWindowMs),
        ),
      ),
    )
    .orderBy(desc(serverMetrics.observedAt))
    .limit(limit)

  return rows.reverse().map(formatMetricSample)
}

export function calculateHeartbeatUptime({
  createdAt,
  heartbeats,
  now,
}: {
  createdAt: Date
  heartbeats: Array<Pick<HeartbeatRow, 'observedAt'>>
  now: Date
}) {
  const windowStart = new Date(
    Math.max(createdAt.getTime(), now.getTime() - uptimeWindowMs),
  )
  const windowMs = now.getTime() - windowStart.getTime()

  if (windowMs <= 0) {
    return null
  }

  const intervals = heartbeats
    .map((heartbeat) => ({
      start: Math.max(heartbeat.observedAt.getTime(), windowStart.getTime()),
      end: Math.min(
        heartbeat.observedAt.getTime() + serverDisconnectedAfterMs,
        now.getTime(),
      ),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start)

  let coveredMs = 0
  let current: { start: number; end: number } | null = null

  for (const interval of intervals) {
    if (!current) {
      current = interval
      continue
    }

    if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end)
      continue
    }

    coveredMs += current.end - current.start
    current = interval
  }

  if (current) {
    coveredMs += current.end - current.start
  }

  return Math.min(100, Math.max(0, (coveredMs / windowMs) * 100))
}

function hasMetrics(metrics: ServerMetricsInput) {
  return Object.keys(metrics).length > 0
}

function formatMetricSample(row: {
  observedAt: Date
  cpuPercent: number | null
  load1: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  diskUsedBytes: number | null
  diskTotalBytes: number | null
}): ServerMetricsSample {
  return {
    observedAt: row.observedAt.toISOString(),
    cpuPercent: row.cpuPercent,
    load1: row.load1,
    memoryUsedBytes: row.memoryUsedBytes,
    memoryTotalBytes: row.memoryTotalBytes,
    diskUsedBytes: row.diskUsedBytes,
    diskTotalBytes: row.diskTotalBytes,
  }
}
