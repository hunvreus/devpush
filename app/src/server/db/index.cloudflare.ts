import { env } from 'cloudflare:workers'
import { createWorkerDatabases } from './worker-connection'

export const { db, logsDb } = createWorkerDatabases(env)

export async function withDatabaseScope<TResult>(
  callback: () => TResult | Promise<TResult>,
  _defer?: (promise: Promise<unknown>) => void,
) {
  return callback()
}

export async function closeDb() {
  // D1 has no pool; remote clients close after each operation.
}
