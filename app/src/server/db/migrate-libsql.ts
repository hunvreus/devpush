import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql/web'
import { migrate } from 'drizzle-orm/libsql/migrator'

export async function migrateLibsql(client: Client, migrationsFolder: string) {
  await migrate(drizzle(client), { migrationsFolder })
}
