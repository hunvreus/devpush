import { getTableName, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { db } from '#devpush/server/db'

/** Connection-independent counts: libSQL batches may use another connection. */
export async function countMutations(
  tables: SQLiteTable[],
  work: () => Promise<unknown>,
) {
  const audit = sql.identifier(`audit_${crypto.randomUUID().replaceAll('-', '')}`)
  const triggers = tables.flatMap((table) =>
    ['insert', 'update', 'delete'].map((operation) => ({
      table,
      operation,
      name: sql.identifier(`${getTableName(table)}_${operation}_${crypto.randomUUID().replaceAll('-', '')}`),
    })),
  )
  await db.run(sql`create table ${audit} (mutations integer not null)`)
  try {
    await db.run(sql`insert into ${audit} values (0)`)
    for (const trigger of triggers)
      await db.run(sql`create trigger ${trigger.name} after ${sql.raw(trigger.operation)} on ${trigger.table}
        begin update ${audit} set mutations = mutations + 1; end`)
    await work()
    const [row] = await db.all(sql`select mutations from ${audit}`)
    return Number(Array.isArray(row) ? row[0] : (row as { mutations: number }).mutations)
  } finally {
    for (const trigger of triggers)
      await db.run(sql`drop trigger if exists ${trigger.name}`)
    await db.run(sql`drop table ${audit}`)
  }
}
