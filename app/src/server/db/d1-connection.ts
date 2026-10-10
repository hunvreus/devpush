import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import { sqliteParams } from './sqlite-params'

type PreparedBatchQuery = {
  getQuery: () => { sql: string; params: unknown[] }
  mapResult: (result: unknown, isFromBatch: boolean) => unknown
}

export function openD1<TSchema extends Record<string, unknown>>(
  binding: D1Database,
  schema: TSchema,
) {
  // Raw SQL interpolations bypass Drizzle's column encoders. Keep their
  // Date/boolean representation consistent with the other SQLite drivers.
  const client = new Proxy(binding, {
    get(target, property) {
      if (property === 'prepare') {
        return (query: string) =>
          new Proxy(target.prepare(query), {
            get(statement, method) {
              if (method === 'bind') {
                return (...params: unknown[]) =>
                  statement.bind(...sqliteParams(params))
              }
              const value: unknown = Reflect.get(statement, method, statement)
              return typeof value === 'function' ? value.bind(statement) : value
            },
          })
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const database = drizzle(client, { schema })
  return new Proxy(database, {
    get(target, property) {
      if (property === 'batch') {
        // Drizzle's D1 batch implementation accesses preparedQuery.stmt, which
        // raw SQL queries do not have. Prepare through the binding for both
        // raw SQL and builders, then keep Drizzle's result mapping.
        return async <
          TItem extends BatchItem<'sqlite'>,
          T extends Readonly<[TItem, ...TItem[]]>,
        >(
          queries: T,
        ): Promise<BatchResponse<T>> => {
          // RunnableQuery omits the internal preparation method that both
          // Drizzle batch implementations require. Keep that boundary here.
          const prepared = queries.map((query) =>
            (
              query as TItem & { _prepare: () => PreparedBatchQuery }
            )._prepare(),
          )
          const statements = prepared.map((query) => {
            const built = query.getQuery()
            return client.prepare(built.sql).bind(...built.params)
          })
          const results = await binding.batch(statements)
          // The library's mapper returns unknown; the query tuple defines the
          // corresponding result types, just as its built-in batch does.
          return results.map((result, index) => {
            const query = prepared[index]
            if (!query) throw new Error('Unexpected D1 batch result count.')
            return query.mapResult(result, true)
          }) as BatchResponse<T>
        }
      }
      // D1 only supports transactions as a prebuilt atomic batch. Never let
      // Drizzle's callback API issue BEGIN or simulate non-atomic statements.
      if (property === 'transaction') {
        return () => {
          throw new Error(
            'D1 requires atomic SQL batches; interactive transaction callbacks are unsupported.',
          )
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
