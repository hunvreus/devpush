import type { Client, ResultSet } from '@libsql/client'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { sqliteParams } from './sqlite-params'

// Preserve positional columns, including duplicate names in joined rows.
function rows(result: ResultSet) {
  return result.rows.map((row) => Array.from(row))
}

export function openLibsql<TSchema extends Record<string, unknown>>(
  connection: Client | (() => Client),
  schema: TSchema,
) {
  async function useClient<TResult>(
    operation: (client: Client) => Promise<TResult>,
  ) {
    const client = typeof connection === 'function' ? connection() : connection
    try {
      return await operation(client)
    } finally {
      // Workers must not retain I/O resources across requests. A factory also
      // keeps streaming responses and scheduled work independent of fetch scope.
      if (typeof connection === 'function') client.close()
    }
  }
  const database = drizzle<TSchema>(
    async (sql, params, method) => {
      const result = rows(
        await useClient((client) =>
          client.execute({ sql, args: sqliteParams(params) }),
        ),
      )
      // Drizzle consumes undefined for a missing get() row, despite requiring
      // an array in AsyncRemoteCallback's return type.
      return {
        rows:
          method === 'get' ? (result[0] as (typeof result)[number]) : result,
      }
    },
    async (queries) => {
      const results = await useClient((client) =>
        client.batch(
          queries.map((query) => ({
            sql: query.sql,
            args: sqliteParams(query.params),
          })),
          'write',
        ),
      )
      return results.map((result) => ({ rows: rows(result) }))
    },
    { schema },
  )
  const db = new Proxy(database, {
    get(target, property) {
      if (property === 'transaction')
        return () => {
          throw new Error(
            'Use atomic SQL batches; callback transactions are unsupported by the libSQL adapter.',
          )
        }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return {
    db,
    close: () => {
      if (typeof connection !== 'function') connection.close()
    },
  }
}
