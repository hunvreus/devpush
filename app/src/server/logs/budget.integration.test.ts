import { afterAll, expect, test } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '#devpush/server/db'
import { rateLimits } from '#devpush/server/db/schema'
import { reserveLogBudget, admitRuntimeLogs } from './budget'

afterAll(closeDb)

test('atomic byte reservations share an allowance across concurrent servers and reset at the window boundary', async () => {
  const teamId = crypto.randomUUID()
  const input = {
    teamId,
    kind: 'test',
    amount: 4,
    limit: 10,
    windowMs: 60_000,
    now: 120_000,
  }
  const results = await Promise.all(
    Array.from({ length: 8 }, () => reserveLogBudget(input)),
  )
  expect(results.filter(Boolean)).toHaveLength(2)
  expect(await reserveLogBudget({ ...input, now: 180_000 })).toBe(true)
  await db
    .delete(rateLimits)
    .where(eq(rateLimits.key, `runtime-log:test:${teamId}`))
})

test('daily byte and row allowances limit multiple ingestion bursts, with UTF-8 and search-column accounting', async () => {
  const teamId = crypto.randomUUID()
  const rows = [{ content: '🔥', searchContent: '🔥' }]
  const limits = { bytesPerMinute: 1000, bytesPerDay: 527, rowsPerDay: 10 }
  expect(await admitRuntimeLogs(teamId, limits, rows)).toBe(true)
  expect(await admitRuntimeLogs(teamId, limits, rows)).toBe(false)
  const secondTeam = crypto.randomUUID()
  const rowLimits = {
    bytesPerMinute: 100_000,
    bytesPerDay: 100_000,
    rowsPerDay: 1,
  }
  expect(await admitRuntimeLogs(secondTeam, rowLimits, rows)).toBe(true)
  expect(await admitRuntimeLogs(secondTeam, rowLimits, rows)).toBe(false)
})

test('invalid budgets fail closed and oversized batches do not use the allowance', async () => {
  const teamId = crypto.randomUUID()
  const input = {
    teamId,
    kind: 'test',
    amount: 11,
    limit: 10,
    windowMs: 60_000,
  }
  expect(await reserveLogBudget(input)).toBe(false)
  expect(await reserveLogBudget({ ...input, amount: 10 })).toBe(true)
  await expect(
    reserveLogBudget({ ...input, limit: Number.NaN }),
  ).rejects.toThrow('Invalid')
})

test('a delayed reservation cannot move a newer window backward', async () => {
  const input = {
    teamId: crypto.randomUUID(),
    kind: 'late',
    amount: 4,
    limit: 10,
    windowMs: 60_000,
  }
  expect(await reserveLogBudget({ ...input, now: 180_000 })).toBe(true)
  expect(await reserveLogBudget({ ...input, now: 120_000 })).toBe(true)
  expect(await reserveLogBudget({ ...input, now: 180_001 })).toBe(false)
})
