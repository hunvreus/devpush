import { createClient } from '@libsql/client/web'
import { openLibsql } from './libsql-connection'
import { remoteDatabaseConfig } from './remote-config'
import { config } from '#devpush/server/config'
import { openSqlite } from './sqlite-connection'
import * as schema from './schema'
import * as logSchema from './log-schema'
import { assertSeparateSqliteFiles } from './sqlite-files'

const remote = remoteDatabaseConfig(config)
if (!remote)
  assertSeparateSqliteFiles(
    config.DEVPUSH_DATABASE_PATH,
    config.DEVPUSH_LOG_DATABASE_PATH,
  )

const main = remote
  ? openLibsql(createClient(remote.main), schema)
  : openSqlite(config.DEVPUSH_DATABASE_PATH, schema)
export const db = main.db
const logStore = remote
  ? openLibsql(createClient(remote.logs), logSchema)
  : openSqlite(config.DEVPUSH_LOG_DATABASE_PATH, logSchema)
export const logsDb = logStore.db

export async function withDatabaseScope<TResult>(
  callback: () => TResult | Promise<TResult>,
  _defer?: (promise: Promise<unknown>) => void,
) {
  return callback()
}

export async function closeDb() {
  await Promise.all([main.close(), logStore.close()])
}
