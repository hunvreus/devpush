import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Sqlite from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { assertKnownMigrationHistory } from './migration-history'

export function migrateSqliteFile(path: string, migrationsFolder: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const connection = new Sqlite(path)
  try {
    const tracked = connection
      .prepare(
        "select name from sqlite_master where type='table' and name='__drizzle_migrations'",
      )
      .get()
    const applied = tracked
      ? (connection.prepare('select hash from __drizzle_migrations').all() as {
          hash: string
        }[])
      : []
    const untracked =
      applied.length === 0 &&
      Boolean(
        connection
          .prepare(
            "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' limit 1",
          )
          .get(),
      )
    assertKnownMigrationHistory(
      applied.map((row) => row.hash),
      readMigrationFiles({ migrationsFolder }).map(
        (migration) => migration.hash,
      ),
      untracked,
    )
    connection.pragma('foreign_keys = ON')
    connection.pragma('journal_mode = WAL')
    connection.pragma('synchronous = FULL')
    migrate(drizzle(connection), { migrationsFolder })
  } finally {
    connection.close()
  }
}
