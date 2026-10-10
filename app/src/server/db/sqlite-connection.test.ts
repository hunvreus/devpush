import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, test } from 'vitest'

import { openSqlite } from './sqlite-connection'

const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    runtimeId: text('runtime_id').notNull(),
    status: text('status').notNull(),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    metadata: text('metadata', { mode: 'json' })
      .$type<{ services: string[] }>()
      .notNull(),
  },
  (table) => [
    uniqueIndex('one_running_job')
      .on(table.runtimeId)
      .where(sql`${table.status} = 'running'`),
  ],
)
const opened: Array<ReturnType<typeof openSqlite<{ jobs: typeof jobs }>>> = []
afterEach(async () => {
  for (const item of opened.splice(0)) await item.close()
})
function createDatabase() {
  const item = openSqlite(':memory:', { jobs })
  item.connection.exec(
    "CREATE TABLE jobs (id text primary key, runtime_id text not null, status text not null, observed_at integer not null, enabled integer not null, metadata text not null); CREATE UNIQUE INDEX one_running_job ON jobs(runtime_id) WHERE status = 'running';",
  )
  opened.push(item)
  return item.db
}
function job(id: string) {
  return {
    id,
    runtimeId: 'runtime',
    status: 'queued',
    observedAt: new Date('2026-06-01T00:00:00.123Z'),
    enabled: true,
    metadata: { services: ['web'] },
  }
}

describe('local SQLite connection', () => {
  test('get returns undefined for a missing row', async () => {
    const db = createDatabase()
    expect(await db.select().from(jobs).get()).toBeUndefined()
  })
  test('round-trips dates, booleans and JSON through asynchronous queries', async () => {
    const db = createDatabase()
    await db.insert(jobs).values(job('one'))
    expect(await db.select().from(jobs)).toEqual([job('one')])
  })
  test('rolls back writes when a callback fails', async () => {
    const db = createDatabase()
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(jobs).values(job('one'))
        throw new Error('failed')
      }),
    ).rejects.toThrow('failed')
    expect(await db.select().from(jobs)).toEqual([])
  })
  test('isolates concurrent requests while a transaction awaits', async () => {
    const db = createDatabase()
    let resume = () => {}
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    let started = () => {}
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const transaction = db.transaction(async (tx) => {
      await tx.insert(jobs).values(job('rolled-back'))
      started()
      await gate
      throw new Error('rollback')
    })
    const rejected = expect(transaction).rejects.toThrow('rollback')
    await ready
    const unrelated = db
      .insert(jobs)
      .values(job('persisted'))
      .returning({ id: jobs.id })
    const read = db.select().from(jobs)
    // Start unrelated operations before allowing the open transaction to finish.
    const pending = Promise.all([unrelated, read])
    resume()
    await rejected
    const [inserted, rows] = await pending
    expect(inserted).toEqual([{ id: 'persisted' }])
    expect(rows.map((row) => row.id)).toEqual(['persisted'])
  })
  test('enforces the running-runtime constraint under competing claims', async () => {
    const db = createDatabase()
    await db.insert(jobs).values([job('one'), job('two')])
    const claims = await Promise.allSettled(
      ['one', 'two'].map((id) =>
        db.transaction(async (tx) =>
          tx
            .update(jobs)
            .set({ status: 'running' })
            .where(eq(jobs.id, id))
            .returning(),
        ),
      ),
    )
    expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(
      1,
    )
    expect(
      await db.select().from(jobs).where(eq(jobs.status, 'running')),
    ).toHaveLength(1)
  })
  test('executes atomic batches with results in order', async () => {
    const db = createDatabase()
    const results = await db.batch([
      db.insert(jobs).values(job('one')).returning(),
      db.select().from(jobs),
    ])
    expect(results).toEqual([[job('one')], [job('one')]])
    await expect(
      db.batch([
        db.insert(jobs).values(job('two')),
        db.insert(jobs).values(job('one')),
      ]),
    ).rejects.toThrow()
    expect(await db.select().from(jobs)).toEqual([job('one')])
  })
})
