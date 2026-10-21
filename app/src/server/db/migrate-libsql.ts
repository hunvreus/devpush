import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql/web'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { assertKnownMigrationHistory } from './migration-history'

export async function migrateLibsql(client: Client, migrationsFolder: string) {
  const tracked = await client.execute(
    "select name from sqlite_master where type='table' and name='__drizzle_migrations'",
  )
  const applied = tracked.rows.length
    ? (await client.execute('select hash from __drizzle_migrations')).rows.map(
        (row) => String(row.hash),
      )
    : []
  const untracked =
    applied.length === 0 &&
    (
      await client.execute(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' limit 1",
      )
    ).rows.length > 0
  assertKnownMigrationHistory(
    applied,
    readMigrationFiles({ migrationsFolder }).map((migration) => migration.hash),
    untracked,
  )
  await migrate(drizzle(client), { migrationsFolder })
}
