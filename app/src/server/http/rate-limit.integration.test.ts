import { describe, expect, test } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { rateLimits } from '@/server/db/schema'
import { enforceRateLimit } from './rate-limit'

function request(path: string, ip: string) {
  const value = new Request(`https://devpush.example${path}`)
  Object.defineProperty(value, 'ip', { value: ip })
  return value
}

describe('shared principal rate limits', () => {
  test('a principal budget follows the actor across transports and IP addresses', async () => {
    const identity = crypto.randomUUID()
    const scope = `principal-test-${crypto.randomUUID()}`
    const options = { identity, scope, limit: 2, windowMs: 60000 }
    expect(
      await enforceRateLimit({
        ...options,
        request: request('/api/v1/projects', '203.0.113.1'),
      }),
    ).toBeNull()
    expect(
      await enforceRateLimit({
        ...options,
        request: request('/mcp', '203.0.113.2'),
      }),
    ).toBeNull()
    const limited = await enforceRateLimit({
      ...options,
      request: request('/mcp', '203.0.113.3'),
    })
    expect(limited?.status).toBe(429)
    expect(Number(limited?.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(
      await enforceRateLimit({ ...options, identity: crypto.randomUUID() }),
    ).toBeNull()
  })

  test('concurrent requests share one atomic counter rather than overrunning the limit', async () => {
    const options = {
      identity: crypto.randomUUID(),
      scope: `principal-test-${crypto.randomUUID()}`,
      limit: 3,
      windowMs: 60000,
    }
    const results = await Promise.all(
      Array.from({ length: 10 }, () => enforceRateLimit(options)),
    )
    expect(results.filter((response) => response === null)).toHaveLength(3)
    expect(results.filter((response) => response?.status === 429)).toHaveLength(
      7,
    )
    const [state] = await db
      .select()
      .from(rateLimits)
      .where(sql`${rateLimits.key} like ${`${options.scope}:%`}`)
    expect(state?.count).toBe(10)
    await db
      .update(rateLimits)
      .set({ resetAt: new Date(0) })
      .where(eq(rateLimits.key, state!.key))
    expect(await enforceRateLimit(options)).toBeNull()
    const [reset] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, state!.key))
    expect(reset?.count).toBe(1)
  })

  test('unauthenticated IP budgets still distinguish callers without an explicit identity', async () => {
    const options = {
      scope: `transport-test-${crypto.randomUUID()}`,
      limit: 1,
      windowMs: 60000,
    }
    expect(
      await enforceRateLimit({
        ...options,
        request: request('/mcp', '203.0.113.1'),
      }),
    ).toBeNull()
    expect(
      (
        await enforceRateLimit({
          ...options,
          request: request('/api/v1/projects', '203.0.113.1'),
        })
      )?.status,
    ).toBe(429)
    expect(
      await enforceRateLimit({
        ...options,
        request: request('/mcp', '203.0.113.2'),
      }),
    ).toBeNull()
  })
})
