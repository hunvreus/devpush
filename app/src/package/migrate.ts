import { createClient } from '@libsql/client/web'
import { migrateLibsql } from '../server/db/migrate-libsql'
import { remoteDatabaseConfig } from '../server/db/remote-config'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { migrateSqliteFile } from '../server/db/migrate-sqlite'
import { assertSeparateSqliteFiles } from '../server/db/sqlite-files'

export async function migrateNode(
  environment: Record<string, string | undefined> = process.env,
  options: { migrationsDirectory?: string } = {},
) {
  const migrationsDirectory =
    options.migrationsDirectory ??
    fileURLToPath(new URL('../../src/server/db', import.meta.url))
  const remote = remoteDatabaseConfig(environment)
  if (remote) {
    for (const [database, directory] of [
      [remote.main, 'migrations-sqlite'],
      [remote.logs, 'migrations-logs'],
    ] as const) {
      const client = createClient(database)
      try {
        await migrateLibsql(client, join(migrationsDirectory, directory))
      } finally {
        client.close()
      }
    }
    console.log('Remote libSQL database migrations applied.')
  } else {
    const path = environment.DEVPUSH_DATABASE_PATH
    const logPath = environment.DEVPUSH_LOG_DATABASE_PATH
    if (!path && environment.NODE_ENV === 'production') {
      throw new Error('DEVPUSH_DATABASE_PATH is required in production.')
    }
    if (!logPath && environment.NODE_ENV === 'production') {
      throw new Error('DEVPUSH_LOG_DATABASE_PATH is required in production.')
    }

    assertSeparateSqliteFiles(
      path ?? '.data/devpush.sqlite',
      logPath ?? '.data/logs.sqlite',
    )

    migrateSqliteFile(
      path ?? '.data/devpush.sqlite',
      join(migrationsDirectory, 'migrations-sqlite'),
    )
    migrateSqliteFile(
      logPath ?? '.data/logs.sqlite',
      join(migrationsDirectory, 'migrations-logs'),
    )
    console.log('SQLite database migrations applied.')
  }
}
