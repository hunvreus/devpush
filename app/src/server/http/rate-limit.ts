import { createHash } from 'node:crypto'

import { lt, sql } from 'drizzle-orm'

import { db } from '@/server/db'
import { rateLimits } from '@/server/db/schema'
import { getRequestPublicAddress } from './request-ip'

export async function enforceRateLimit({
  limit,
  request,
  scope,
  windowMs,
}: {
  limit: number
  request: Request
  scope: string
  windowMs: number
}) {
  const identity = getRequestPublicAddress(request) ?? 'unknown-address'
  const key = `${scope}:${createHash('sha256').update(identity).digest('hex')}`
  const now = new Date()
  const resetAt = new Date(now.getTime() + windowMs)
  const rows = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql<number>`case when ${rateLimits.resetAt} <= ${now} then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql<Date>`case when ${rateLimits.resetAt} <= ${now} then ${resetAt} else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt })
  const state = rows[0]
  if (!state) throw new Error('Rate limit update returned no state.')

  if (state.count <= limit) {
    return null
  }

  const retryAfter = Math.max(
    1,
    Math.ceil((state.resetAt.getTime() - now.getTime()) / 1000),
  )
  return Response.json(
    { error: 'Too many requests. Try again later.' },
    { status: 429, headers: { 'retry-after': String(retryAfter) } },
  )
}

export async function cleanupExpiredRateLimits() {
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date()))
}
