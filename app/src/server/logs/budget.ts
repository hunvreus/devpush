import { sql } from 'drizzle-orm'
import { db } from '#devpush/server/db'
import { rateLimits } from '#devpush/server/db/schema'
import type { RuntimeLogLimits } from '#devpush/plugins/contract'

/** Atomic, persistent reservations. Failed writes retain their reservation (fail closed). */
export async function reserveLogBudget({
  teamId,
  kind,
  amount,
  limit,
  windowMs,
  now = Date.now(),
}: {
  teamId: string
  kind: string
  amount: number
  limit: number
  windowMs: number
  now?: number
}) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('Invalid runtime log budget.')
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > limit)
    return false
  const resetAt = new Date((Math.floor(now / windowMs) + 1) * windowMs)
  const timestamp = new Date(now)
  const count = sql<number>`case when ${rateLimits.resetAt} <= ${timestamp} then ${amount} else ${rateLimits.count} + ${amount} end`
  const result = await db
    .insert(rateLimits)
    .values({ key: `runtime-log:${kind}:${teamId}`, count: amount, resetAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count,
        resetAt: sql`case when ${rateLimits.resetAt} <= ${timestamp} then ${resetAt} else ${rateLimits.resetAt} end`,
      },
      setWhere: sql`${count} <= ${limit}`,
    })
    .returning({ key: rateLimits.key })
  return result.length === 1
}

export async function admitRuntimeLogs(
  teamId: string,
  limits: RuntimeLogLimits,
  rows: readonly { content: string; searchContent: string }[],
) {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error('Invalid runtime log limits.')
  }
  const encoder = new TextEncoder()
  // Include both stored text columns and an allowance for row identifiers/metadata.
  const bytes = rows.reduce(
    (sum, row) =>
      sum +
      encoder.encode(row.content).length +
      encoder.encode(row.searchContent).length +
      256,
    0,
  )
  for (const [kind, amount, limit, windowMs] of [
    ['minute', bytes, limits.bytesPerMinute, 60_000],
    ['day', bytes, limits.bytesPerDay, 86_400_000],
    ['rows', rows.length, limits.rowsPerDay, 86_400_000],
  ] as const) {
    if (!(await reserveLogBudget({ teamId, kind, amount, limit, windowMs })))
      return false
  }
  return true
}
