import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import type { SQL } from 'drizzle-orm'
import type { SQLiteRaw } from 'drizzle-orm/sqlite-core/query-builders/raw'

// Both drivers execute a prebuilt batch atomically. Queries must encode their
// guards in SQL; reads made before the batch are not an authorization snapshot.
export type AtomicStore = {
  run: (query: SQL) => SQLiteRaw<unknown>
  all: <T = unknown>(query: SQL) => SQLiteRaw<T[]>
  batch: <
    TItem extends BatchItem<'sqlite'>,
    T extends Readonly<[TItem, ...TItem[]]>,
  >(
    queries: T,
  ) => Promise<BatchResponse<T>>
}
