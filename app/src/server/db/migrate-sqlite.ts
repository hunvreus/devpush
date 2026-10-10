import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Sqlite from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export function migrateSqliteFile(path: string, migrationsFolder: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const connection = new Sqlite(path)
  try {
    connection.pragma('foreign_keys = ON')
    connection.pragma('journal_mode = WAL')
    connection.pragma('synchronous = FULL')
    migrate(drizzle(connection), { migrationsFolder })
  } finally {
    connection.close()
  }
}
