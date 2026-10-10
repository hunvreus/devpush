import { required } from '@/test/required'
import { like } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import { rateLimits } from '@/server/db/schema'
import { cleanupExpiredRateLimits, enforceRateLimit } from './rate-limit'

const scope = `integration:${crypto.randomUUID()}`

afterEach(async () => {
  await db.delete(rateLimits).where(like(rateLimits.key, `${scope}:%`))
})

afterAll(async () => {
  await closeDb()
})

describe('persistent rate limiting', () => {
  test('allows requests up to the limit and rejects the next request', async () => {
    expect(await check()).toBeNull()
    expect(await check()).toBeNull()

    const response = await check()

    expect(response?.status).toBe(429)
    expect(Number(response?.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  test('starts a new window after the previous window expires', async () => {
    expect(await check()).toBeNull()
    await db
      .update(rateLimits)
      .set({ resetAt: new Date(Date.now() - 1_000) })
      .where(like(rateLimits.key, `${scope}:%`))

    expect(await check()).toBeNull()

    const [state] = await db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(like(rateLimits.key, `${scope}:%`))
    expect(required(state).count).toBe(1)
  })

  test('removes expired counters', async () => {
    expect(await check()).toBeNull()
    await db
      .update(rateLimits)
      .set({ resetAt: new Date(Date.now() - 1_000) })
      .where(like(rateLimits.key, `${scope}:%`))

    await cleanupExpiredRateLimits()

    const rows = await db
      .select({ key: rateLimits.key })
      .from(rateLimits)
      .where(like(rateLimits.key, `${scope}:%`))
    expect(rows).toEqual([])
  })

  test('uses the direct peer address instead of the user agent', async () => {
    expect(await check({ ip: '192.0.2.10', userAgent: 'first' })).toBeNull()
    expect(await check({ ip: '192.0.2.10', userAgent: 'second' })).toBeNull()
    expect(await check({ ip: '192.0.2.10', userAgent: 'third' })).toMatchObject(
      { status: 429 },
    )
    expect(await check({ ip: '192.0.2.11', userAgent: 'first' })).toBeNull()
  })
})

function check({
  ip = '203.0.113.10',
  userAgent = 'devpush-test',
}: {
  ip?: string
  userAgent?: string
} = {}) {
  const request = new Request('https://devpush.example.test', {
    headers: { 'user-agent': userAgent },
  })
  Object.defineProperty(request, 'ip', { value: ip })

  return enforceRateLimit({
    limit: 2,
    request,
    scope,
    windowMs: 60_000,
  })
}
