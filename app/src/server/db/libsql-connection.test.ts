import { required } from '#devpush/test/required'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'
import { openLibsql } from './libsql-connection'
import { migrateLibsql } from './migrate-libsql'

const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  when: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
})
test('maps rows and RETURNING, rejects partial batches, and preserves concurrent winners', async () => {
  const client = createClient({ url: ':memory:' })
  const { db, close } = openLibsql(client, { items })
  try {
    await db.run(
      sql`create table items(id text primary key, observed_at integer not null)`,
    )
    await db.batch([
      db.insert(items).values({ id: 'one', when: new Date(42) }),
      db.insert(items).values({ id: 'two', when: new Date(43) }),
    ])
    expect(await db.select().from(items)).toEqual([
      { id: 'one', when: new Date(42) },
      { id: 'two', when: new Date(43) },
    ])
    await expect(
      db.batch([
        db.insert(items).values({ id: 'three', when: new Date() }),
        db.insert(items).values({ id: 'one', when: new Date() }),
      ]),
    ).rejects.toThrow()
    expect(await db.select().from(items)).toHaveLength(2)
    const winners = await Promise.allSettled([
      db.insert(items).values({ id: 'winner', when: new Date() }),
      db.insert(items).values({ id: 'winner', when: new Date() }),
    ])
    expect(winners.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
    expect(await db.all(sql`select id from items where id='winner'`)).toEqual([
      ['winner'],
    ])
    const [returned] = await db.batch([
      db
        .delete(items)
        .where(sql`id='winner'`)
        .returning(),
    ])
    expect(required(returned[0]).id).toBe('winner')
  } finally {
    close()
  }
})

test('applies both migration sets idempotently through libSQL', async () => {
  for (const directory of ['migrations-sqlite', 'migrations-logs']) {
    const client = createClient({ url: ':memory:' })
    try {
      const path = fileURLToPath(new URL(`./${directory}`, import.meta.url))
      await migrateLibsql(client, path)
      await migrateLibsql(client, path)
      const result = await drizzle(client).all(
        sql`select name from sqlite_master where type='table'`,
      )
      expect(result.length).toBeGreaterThan(1)
    } finally {
      client.close()
    }
  }
})

test('factory clients are isolated and closed after successful and failed operations', async () => {
  const clients: ReturnType<typeof createClient>[] = []
  const { db } = openLibsql(() => {
    const client = createClient({ url: ':memory:' })
    clients.push(client)
    return client
  }, {})
  await Promise.all([
    db.all(sql`select 1`),
    db.batch([
      db.run(sql`create table isolated(id integer)`),
      db.run(sql`insert into isolated values(1)`),
    ]),
  ])
  await expect(db.run(sql`insert into missing values(1)`)).rejects.toThrow()
  expect(clients).toHaveLength(3)
  expect(clients.every((client) => client.closed)).toBe(true)
})

test('get returns undefined for a missing row', async () => {
  const client = createClient({ url: ':memory:' })
  const { db, close } = openLibsql(client, {})
  try {
    expect(await db.get(sql`select 1 where 0`)).toBeUndefined()
  } finally {
    close()
  }
})
