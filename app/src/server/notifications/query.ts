import type { SQL } from 'drizzle-orm'
import { db } from '#devpush/server/db'

/** Raw Drizzle rows are positional on SQLite/libSQL and named on D1. */
export async function notificationRows<T>(
  query: SQL,
  columns: readonly (keyof T)[],
): Promise<T[]> {
  const rows: unknown[] = await db.all(query)
  return rows.map(
    (row) =>
      (Array.isArray(row)
        ? Object.fromEntries(columns.map((key, index) => [key, row[index]]))
        : row) as T,
  )
}
