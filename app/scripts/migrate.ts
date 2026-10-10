import { createClient } from '@libsql/client/web'
import { migrateLibsql } from '../src/server/db/migrate-libsql'
import { remoteDatabaseConfig } from '../src/server/db/remote-config'
import { fileURLToPath } from 'node:url'

import { migrateSqliteFile } from '../src/server/db/migrate-sqlite'
import { assertSeparateSqliteFiles } from '../src/server/db/sqlite-files'

const remote = remoteDatabaseConfig(process.env)
if (remote) {
  for (const [options, directory] of [
    [remote.main, 'migrations-sqlite'],
    [remote.logs, 'migrations-logs'],
  ] as const) {
    const client = createClient(options)
    try {
      await migrateLibsql(
        client,
        fileURLToPath(
          new URL(`../src/server/db/${directory}`, import.meta.url),
        ),
      )
    } finally {
      client.close()
    }
  }
  console.log('Remote libSQL database migrations applied.')
} else {
  const path = process.env.DEVPUSH_DATABASE_PATH
  const logPath = process.env.DEVPUSH_LOG_DATABASE_PATH
  if (!path && process.env.NODE_ENV === 'production') {
    throw new Error('DEVPUSH_DATABASE_PATH is required in production.')
  }
  if (!logPath && process.env.NODE_ENV === 'production') {
    throw new Error('DEVPUSH_LOG_DATABASE_PATH is required in production.')
  }

  assertSeparateSqliteFiles(
    path ?? '.data/devpush.sqlite',
    logPath ?? '.data/logs.sqlite',
  )

  migrateSqliteFile(
    path ?? '.data/devpush.sqlite',
    fileURLToPath(
      new URL('../src/server/db/migrations-sqlite', import.meta.url),
    ),
  )
  migrateSqliteFile(
    logPath ?? '.data/logs.sqlite',
    fileURLToPath(new URL('../src/server/db/migrations-logs', import.meta.url)),
  )
  console.log('SQLite database migrations applied.')
}
