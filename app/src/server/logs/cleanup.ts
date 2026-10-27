import { eq, gt, inArray, sql } from 'drizzle-orm'

import { db, logsDb } from '#devpush/server/db'
import {
  deploymentLogs,
  logCleanupPositions,
} from '#devpush/server/db/log-schema'
import { deployments } from '#devpush/server/db/schema'

const positionId = 'deployment-output'

// Cross-file foreign keys cannot cascade. Walk indexed deployment identities
// incrementally and delete only output whose main deployment no longer exists.
export async function pruneOrphanDeploymentLogs() {
  const [position] = await logsDb
    .select()
    .from(logCleanupPositions)
    .where(eq(logCleanupPositions.id, positionId))
  const cursor = position?.cursor ?? null
  const candidates = await logsDb
    .selectDistinct({ id: deploymentLogs.deploymentId })
    .from(deploymentLogs)
    .where(cursor ? gt(deploymentLogs.deploymentId, cursor) : undefined)
    .orderBy(deploymentLogs.deploymentId)
    .limit(80)
  const ids = candidates.map((row) => row.id)
  const live = ids.length
    ? await db
        .select({ id: deployments.id })
        .from(deployments)
        .where(inArray(deployments.id, ids))
    : []
  const existing = new Set(live.map((row) => row.id))
  const missing = ids.filter((id) => !existing.has(id))
  // Stay on this range while orphan output remains, even when one deployment
  // has much more than a batch of output. Each run deletes at most 1,000 rows.
  const nextCursor = missing.length ? cursor : (candidates.at(-1)?.id ?? null)
  const savePosition = logsDb
    .insert(logCleanupPositions)
    .values({ id: positionId, cursor: nextCursor })
    .onConflictDoUpdate({
      target: logCleanupPositions.id,
      set: { cursor: nextCursor },
    })
  if (!missing.length) {
    await savePosition
    return { checked: ids.length, deleted: 0 }
  }
  const [deleted] = await logsDb.batch([
    logsDb
      .delete(deploymentLogs)
      .where(
        sql`rowid in (
      select rowid from ${deploymentLogs}
      where ${inArray(deploymentLogs.deploymentId, missing)}
      order by ${deploymentLogs.deploymentId}, ${deploymentLogs.stream}, ${deploymentLogs.seq}
      limit 1000
    )`,
      )
      .returning({ seq: deploymentLogs.seq }),
    savePosition,
  ])
  return { checked: ids.length, deleted: deleted.length }
}
