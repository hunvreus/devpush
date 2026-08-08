import { randomUUID } from 'node:crypto'

import { and, desc, eq, gt, gte, inArray, isNull, lt, or } from 'drizzle-orm'

import { db } from '@/server/db'
import {
  serverAvailabilityWindows,
  serverHeartbeats,
  serverMetrics,
} from '@/server/db/schema'
import { serverDisconnectedAfterMs } from '@/server/servers/status'
import type { ServerStatus } from '@/server/servers/status'

const availabilityWindowMaxMs = 24 * 60 * 60 * 1000
const metricsWindowMs = 24 * 60 * 60 * 1000
const defaultMetricsLimit = 3_000
const metricGapAfterMs = 75_000

export type ServerMonitoringSummary = {
  availabilityPercent: number | null
  availabilityWindowMs: number
  latestMetrics: ServerMetricsSample | null
}

export type ServerMetricsInput = {
  cpuPercent?: number
  memoryUsedBytes?: number
  memoryTotalBytes?: number
  diskUsedBytes?: number
  diskTotalBytes?: number
  networkReceiveBytesPerSecond?: number
  networkTransmitBytesPerSecond?: number
  diskReadBytesPerSecond?: number
  diskWriteBytesPerSecond?: number
}

export type ServerMetricsSample = {
  observedAt: string
  cpuPercent: number | null
  load1: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  diskUsedBytes: number | null
  diskTotalBytes: number | null
  networkReceiveBytesPerSecond: number | null
  networkTransmitBytesPerSecond: number | null
  diskReadBytesPerSecond: number | null
  diskWriteBytesPerSecond: number | null
}

type ServerWindow = {
  id: string
  createdAt: Date
  status?: ServerStatus
}

type HeartbeatRow = {
  serverId: string
  observedAt: Date
}

type AvailabilityWindow = {
  startedAt: Date
  endedAt: Date | null
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
    memoryUsedBytes: metrics.memoryUsedBytes ?? null,
    memoryTotalBytes: metrics.memoryTotalBytes ?? null,
    diskUsedBytes: metrics.diskUsedBytes ?? null,
    diskTotalBytes: metrics.diskTotalBytes ?? null,
    networkReceiveBytesPerSecond: metrics.networkReceiveBytesPerSecond ?? null,
    networkTransmitBytesPerSecond:
      metrics.networkTransmitBytesPerSecond ?? null,
    diskReadBytesPerSecond: metrics.diskReadBytesPerSecond ?? null,
    diskWriteBytesPerSecond: metrics.diskWriteBytesPerSecond ?? null,
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
      availabilityPercent: null,
      availabilityWindowMs: 0,
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
          new Date(
            now.getTime() - availabilityWindowMaxMs - serverDisconnectedAfterMs,
          ),
        ),
      ),
    )

  const availabilityRows = await db
    .select({
      serverId: serverAvailabilityWindows.serverId,
      startedAt: serverAvailabilityWindows.startedAt,
      endedAt: serverAvailabilityWindows.endedAt,
    })
    .from(serverAvailabilityWindows)
    .where(
      and(
        inArray(serverAvailabilityWindows.serverId, serverIds),
        lt(serverAvailabilityWindows.startedAt, now),
        or(
          isNull(serverAvailabilityWindows.endedAt),
          gt(
            serverAvailabilityWindows.endedAt,
            new Date(now.getTime() - availabilityWindowMaxMs),
          ),
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
          networkReceiveBytesPerSecond:
            serverMetrics.networkReceiveBytesPerSecond,
          networkTransmitBytesPerSecond:
            serverMetrics.networkTransmitBytesPerSecond,
          diskReadBytesPerSecond: serverMetrics.diskReadBytesPerSecond,
          diskWriteBytesPerSecond: serverMetrics.diskWriteBytesPerSecond,
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
    const persistedWindows = availabilityRows
      .filter((row) => row.serverId === server.id)
      .map((row) => ({
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      }))
    const availabilityWindows =
      persistedWindows.length > 0
        ? persistedWindows
        : server.status === 'disabled'
          ? []
          : [{ startedAt: server.createdAt, endedAt: null }]

    const availability = calculateHeartbeatAvailability({
      availabilityWindows,
      heartbeats,
      now,
    })

    summaries.set(server.id, {
      availabilityPercent: availability.percent,
      availabilityWindowMs: availability.windowMs,
      latestMetrics: latestMetrics.get(server.id) ?? null,
    })
  }

  return summaries
}

export function calculateHeartbeatAvailability({
  availabilityWindows,
  heartbeats,
  now,
}: {
  availabilityWindows: Array<AvailabilityWindow>
  heartbeats: Array<Pick<HeartbeatRow, 'observedAt'>>
  now: Date
}) {
  const windowStart = now.getTime() - availabilityWindowMaxMs
  const eligibleIntervals = mergeIntervals(
    availabilityWindows
      .map((window) => ({
        start: Math.max(window.startedAt.getTime(), windowStart),
        end: Math.min(
          window.endedAt?.getTime() ?? now.getTime(),
          now.getTime(),
        ),
      }))
      .filter((interval) => interval.end > interval.start),
  )
  const eligibleMs = sumIntervals(eligibleIntervals)

  if (eligibleMs <= 0) {
    return { percent: null, windowMs: 0 }
  }

  const heartbeatIntervals = mergeIntervals(
    heartbeats
      .map((heartbeat) => ({
        start: Math.max(heartbeat.observedAt.getTime(), windowStart),
        end: Math.min(
          heartbeat.observedAt.getTime() + serverDisconnectedAfterMs,
          now.getTime(),
        ),
      }))
      .filter((interval) => interval.end > interval.start),
  )
  const coveredMs = sumIntervals(
    intersectIntervals(heartbeatIntervals, eligibleIntervals),
  )

  return {
    percent: Math.min(100, Math.max(0, (coveredMs / eligibleMs) * 100)),
    windowMs: eligibleMs,
  }
}

export async function listServerMetricSeries({
  serverId,
  now = new Date(),
  startAt,
  limit = defaultMetricsLimit,
}: {
  serverId: string
  now?: Date
  startAt?: Date
  limit?: number
}): Promise<Array<ServerMetricsSample>> {
  const seriesStart = new Date(
    Math.max(
      startAt?.getTime() ?? Number.NEGATIVE_INFINITY,
      now.getTime() - metricsWindowMs,
    ),
  )
  const [rows, availabilityWindows] = await Promise.all([
    db
      .select({
        observedAt: serverMetrics.observedAt,
        cpuPercent: serverMetrics.cpuPercent,
        load1: serverMetrics.load1,
        memoryUsedBytes: serverMetrics.memoryUsedBytes,
        memoryTotalBytes: serverMetrics.memoryTotalBytes,
        diskUsedBytes: serverMetrics.diskUsedBytes,
        diskTotalBytes: serverMetrics.diskTotalBytes,
        networkReceiveBytesPerSecond:
          serverMetrics.networkReceiveBytesPerSecond,
        networkTransmitBytesPerSecond:
          serverMetrics.networkTransmitBytesPerSecond,
        diskReadBytesPerSecond: serverMetrics.diskReadBytesPerSecond,
        diskWriteBytesPerSecond: serverMetrics.diskWriteBytesPerSecond,
      })
      .from(serverMetrics)
      .where(
        and(
          eq(serverMetrics.serverId, serverId),
          gte(serverMetrics.observedAt, seriesStart),
        ),
      )
      .orderBy(desc(serverMetrics.observedAt))
      .limit(limit),
    db
      .select({
        startedAt: serverAvailabilityWindows.startedAt,
        endedAt: serverAvailabilityWindows.endedAt,
      })
      .from(serverAvailabilityWindows)
      .where(
        and(
          eq(serverAvailabilityWindows.serverId, serverId),
          lt(serverAvailabilityWindows.startedAt, now),
          or(
            isNull(serverAvailabilityWindows.endedAt),
            gt(serverAvailabilityWindows.endedAt, seriesStart),
          ),
        ),
      ),
  ])

  return insertMetricGaps(
    rows.reverse().map(formatMetricSample),
    metricGapAfterMs,
    availabilityWindows,
  )
}

export function insertMetricGaps(
  samples: Array<ServerMetricsSample>,
  gapAfterMs = metricGapAfterMs,
  availabilityWindows: Array<AvailabilityWindow> = [],
) {
  const points: Array<ServerMetricsSample> = []
  const windows = [...availabilityWindows].sort(
    (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
  )
  const visibleSamples =
    windows.length === 0
      ? samples
      : samples.filter((sample) => {
          const observedAt = new Date(sample.observedAt).getTime()
          return windows.some(
            (window) =>
              observedAt >= window.startedAt.getTime() &&
              observedAt <=
                (window.endedAt?.getTime() ?? Number.POSITIVE_INFINITY),
          )
        })

  for (const sample of visibleSamples) {
    const previous = points.at(-1)
    if (
      previous &&
      new Date(sample.observedAt).getTime() -
        new Date(previous.observedAt).getTime() >
        gapAfterMs
    ) {
      points.push({
        observedAt: new Date(
          (new Date(previous.observedAt).getTime() +
            new Date(sample.observedAt).getTime()) /
            2,
        ).toISOString(),
        cpuPercent: null,
        load1: null,
        memoryUsedBytes: null,
        memoryTotalBytes: null,
        diskUsedBytes: null,
        diskTotalBytes: null,
        networkReceiveBytesPerSecond: null,
        networkTransmitBytesPerSecond: null,
        diskReadBytesPerSecond: null,
        diskWriteBytesPerSecond: null,
      })
    }

    points.push(sample)
  }

  for (let index = 1; index < windows.length; index += 1) {
    const disabledAt = windows[index - 1]?.endedAt?.getTime()
    if (disabledAt === undefined) {
      continue
    }

    const enabledAt = windows[index].startedAt.getTime()
    points.push(emptyMetricSample(new Date((disabledAt + enabledAt) / 2)))
  }

  return points.sort(
    (left, right) =>
      new Date(left.observedAt).getTime() -
      new Date(right.observedAt).getTime(),
  )
}

function emptyMetricSample(observedAt: Date): ServerMetricsSample {
  return {
    observedAt: observedAt.toISOString(),
    cpuPercent: null,
    load1: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    diskUsedBytes: null,
    diskTotalBytes: null,
    networkReceiveBytesPerSecond: null,
    networkTransmitBytesPerSecond: null,
    diskReadBytesPerSecond: null,
    diskWriteBytesPerSecond: null,
  }
}

function mergeIntervals(intervals: Array<{ start: number; end: number }>) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []

  for (const interval of sorted) {
    const current = merged.at(-1)
    if (!current || interval.start > current.end) {
      merged.push({ ...interval })
      continue
    }

    current.end = Math.max(current.end, interval.end)
  }

  return merged
}

function intersectIntervals(
  left: Array<{ start: number; end: number }>,
  right: Array<{ start: number; end: number }>,
) {
  const intersections: Array<{ start: number; end: number }> = []
  let leftIndex = 0
  let rightIndex = 0

  while (leftIndex < left.length && rightIndex < right.length) {
    const start = Math.max(left[leftIndex].start, right[rightIndex].start)
    const end = Math.min(left[leftIndex].end, right[rightIndex].end)

    if (end > start) {
      intersections.push({ start, end })
    }

    if (left[leftIndex].end < right[rightIndex].end) {
      leftIndex += 1
    } else {
      rightIndex += 1
    }
  }

  return intersections
}

function sumIntervals(intervals: Array<{ start: number; end: number }>) {
  return intervals.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  )
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
  networkReceiveBytesPerSecond: number | null
  networkTransmitBytesPerSecond: number | null
  diskReadBytesPerSecond: number | null
  diskWriteBytesPerSecond: number | null
}): ServerMetricsSample {
  return {
    observedAt: row.observedAt.toISOString(),
    cpuPercent: row.cpuPercent,
    load1: row.load1,
    memoryUsedBytes: row.memoryUsedBytes,
    memoryTotalBytes: row.memoryTotalBytes,
    diskUsedBytes: row.diskUsedBytes,
    diskTotalBytes: row.diskTotalBytes,
    networkReceiveBytesPerSecond: row.networkReceiveBytesPerSecond,
    networkTransmitBytesPerSecond: row.networkTransmitBytesPerSecond,
    diskReadBytesPerSecond: row.diskReadBytesPerSecond,
    diskWriteBytesPerSecond: row.diskWriteBytesPerSecond,
  }
}
