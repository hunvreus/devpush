import { inArray, lt } from 'drizzle-orm'

import { logsDb } from '@/server/db'
import { runtimeLogs } from '@/server/db/log-schema'

export const runtimeLogRetentionMs = 24 * 60 * 60 * 1000
export const runtimeLogPruneBatchSize = 1_000

// Global cleanup includes runtimes that no longer report logs or whose main
// records have been deleted. No cross-database foreign keys are available.
export async function pruneExpiredRuntimeLogs(now = new Date()) {
  const cutoff = new Date(now.getTime() - runtimeLogRetentionMs)
  let deleted = 0
  for (let batch = 0; batch < 10; batch++) {
    const rows = await logsDb
      .delete(runtimeLogs)
      .where(
        inArray(
          runtimeLogs.id,
          logsDb
            .select({ id: runtimeLogs.id })
            .from(runtimeLogs)
            .where(lt(runtimeLogs.observedAt, cutoff))
            .orderBy(runtimeLogs.observedAt, runtimeLogs.id)
            .limit(runtimeLogPruneBatchSize),
        ),
      )
      .returning({ id: runtimeLogs.id })
    deleted += rows.length
    if (rows.length < runtimeLogPruneBatchSize) break
  }
  return { deleted }
}
