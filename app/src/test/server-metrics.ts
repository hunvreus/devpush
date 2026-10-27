import { randomUUID } from 'node:crypto'
import { db } from '#devpush/server/db'
import { serverMetrics } from '#devpush/server/db/schema'

type ServerMetricsInput = {
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

export async function recordServerMetrics({
  serverId,
  observedAt,
  metrics,
}: {
  serverId: string
  observedAt: Date
  metrics: ServerMetricsInput
}) {
  if (Object.keys(metrics).length === 0) {
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
