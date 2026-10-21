import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Sqlite from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import type {
  AsyncRemoteCallback,
  SqliteRemoteDatabase,
} from 'drizzle-orm/sqlite-proxy'

import { sqliteParams } from './sqlite-params'

export function openSqlite<TSchema extends Record<string, unknown>>(
  path: string,
  schema: TSchema,
) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const connection = new Sqlite(path)
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = FULL')
  connection.pragma('busy_timeout = 5000')

  // Callbacks may await between statements. Serialize unrelated operations on
  // this connection so they cannot join another request's uncommitted work.
  const transactionScope = new AsyncLocalStorage<{ active: boolean }>()
  let tail = Promise.resolve()
  async function exclusive<T>(work: () => T | Promise<T>): Promise<T> {
    if (transactionScope.getStore()?.active) return work()
    const previous = tail
    let release = () => {}
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    const scope = { active: true }
    try {
      return await transactionScope.run(scope, work)
    } finally {
      scope.active = false
      release()
    }
  }
  function query(
    sql: string,
    params: unknown[],
    method: Parameters<AsyncRemoteCallback>[2],
    batch = false,
  ) {
    const statement = connection.prepare(sql)
    const values = sqliteParams(params)
    if (method === 'run') {
      statement.run(...values)
      return { rows: [] }
    }
    const rows = statement.raw(true).all(...values) as unknown[][]
    // Drizzle's callback type requires an array even though get() uses an
    // undefined first row to represent no match. Keep that library contract.
    return { rows: method === 'get' && !batch ? (rows[0] as unknown[]) : rows }
  }
  const database = drizzle<TSchema>(
    (sql, params: unknown[], method) =>
      exclusive(() => query(sql, params, method)),
    (queries) =>
      exclusive(() =>
        connection
          .transaction(() =>
            queries.map((entry) =>
              query(entry.sql, entry.params, entry.method, true),
            ),
          )
          .immediate(),
      ),
    { schema },
  )
  const db = new Proxy(database, {
    get(target, property) {
      if (property === 'transaction') {
        const transaction: SqliteRemoteDatabase<TSchema>['transaction'] = (
          callback,
          options,
        ) =>
          exclusive(() =>
            target.transaction(callback, { ...options, behavior: 'immediate' }),
          )
        return transaction
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { db, connection, close: () => exclusive(() => connection.close()) }
}
