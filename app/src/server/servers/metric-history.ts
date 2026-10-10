import type { AgentMetricSample } from './metric-history-schema'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'

import { config } from '@/server/config'
import { db } from '@/server/db'
import type { AtomicStore } from '@/server/db/atomic'

// Samples have stable random identities, so retries and clock changes cannot
// collide. Namespace them by the authenticated server using the existing PK.
export function metricRowId(serverId: string, sampleId: string) {
  return createHash('sha256').update(`${serverId}\0${sampleId}`).digest('hex')
}

export async function recordAgentMetricSamples(
  serverId: string,
  samples: Array<AgentMetricSample>,
  now = new Date(),
  store: Pick<AtomicStore, 'run'> = db,
) {
  if (samples.length === 0) return undefined
  const cutoff =
    now.getTime() - config.DEVPUSH_MONITORING_RETENTION_DAYS * 86_400_000
  const rows = samples
    .filter((sample) => Date.parse(sample.observedAt) >= cutoff)
    .map((sample) => ({
      id: metricRowId(serverId, sample.id),
      observedAt: Date.parse(sample.observedAt),
      ...sample.metrics,
    }))
  if (rows.length > 0) {
    // One JSON parameter avoids D1's 100-parameter limit. A single insert is
    // atomic; the response acknowledges only after persistence completes.
    await store.run(sql`
      insert into server_metrics (
        id, server_id, observed_at, cpu_percent, memory_used_bytes,
        memory_total_bytes, disk_used_bytes, disk_total_bytes,
        network_receive_bytes_per_second, network_transmit_bytes_per_second,
        disk_read_bytes_per_second, disk_write_bytes_per_second
      )
      select
        json_extract(value, '$.id'), ${serverId},
        json_extract(value, '$.observedAt'), json_extract(value, '$.cpuPercent'),
        json_extract(value, '$.memoryUsedBytes'), json_extract(value, '$.memoryTotalBytes'),
        json_extract(value, '$.diskUsedBytes'), json_extract(value, '$.diskTotalBytes'),
        json_extract(value, '$.networkReceiveBytesPerSecond'),
        json_extract(value, '$.networkTransmitBytesPerSecond'),
        json_extract(value, '$.diskReadBytesPerSecond'), json_extract(value, '$.diskWriteBytesPerSecond')
      from json_each(${JSON.stringify(rows)}) where true
      on conflict (id) do nothing
    `)
  }
  // Older-than-retention records are deliberately expired, not retried forever.
  return samples.at(-1)?.id
}
