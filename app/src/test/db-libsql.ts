import { createClient } from '@libsql/client'
import { pathToFileURL } from 'node:url'
import { openLibsql } from '@/server/db/libsql-connection'
import * as schema from '@/server/db/schema'
import * as logSchema from '@/server/db/log-schema'

const main = openLibsql(
  createClient({ url: pathToFileURL(process.env.DEVPUSH_DATABASE_PATH!).href }),
  schema,
)
const logs = openLibsql(
  createClient({
    url: pathToFileURL(process.env.DEVPUSH_LOG_DATABASE_PATH!).href,
  }),
  logSchema,
)
export const db = main.db
export const logsDb = logs.db
export async function closeDb() {
  main.close()
  logs.close()
}
export async function withDatabaseScope<T>(callback: () => T | Promise<T>) {
  return callback()
}
