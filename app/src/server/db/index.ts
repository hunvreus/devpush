import { AsyncLocalStorage } from 'node:async_hooks'

import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Client, Pool } from 'pg'

import { config } from '@/server/config'
import {
  getDatabaseConnectionString,
  requiresRequestScopedDatabase,
} from '@/server/runtime/platform-env'
import * as schema from './schema'

type Database = NodePgDatabase<typeof schema>

const connectionString = getDatabaseConnectionString() ?? config.DATABASE_URL
const requestDatabases = new AsyncLocalStorage<Database>()
const pool = requiresRequestScopedDatabase()
  ? undefined
  : new Pool({ connectionString })
const pooledDatabase = pool ? drizzle(pool, { schema }) : undefined

export const db = new Proxy({} as Database, {
  get(_target, property) {
    const database = requestDatabases.getStore() ?? pooledDatabase
    if (!database) {
      throw new Error('Database access requires an active request scope.')
    }

    const value = Reflect.get(database, property, database) as unknown
    return typeof value === 'function' ? value.bind(database) : value
  },
})

export async function withDatabaseScope<TResult>(
  callback: () => TResult | Promise<TResult>,
) {
  if (pooledDatabase || requestDatabases.getStore()) {
    return callback()
  }

  const client = new Client({ connectionString })
  await client.connect()

  try {
    return await requestDatabases.run(drizzle(client, { schema }), callback)
  } finally {
    await client.end()
  }
}

export async function closeDb() {
  await pool?.end()
}
