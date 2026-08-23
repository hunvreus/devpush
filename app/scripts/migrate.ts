import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://devpush:devpush@localhost:7543/devpush'

const pool = new Pool({ connectionString: databaseUrl, max: 1 })

try {
  await migrate(drizzle(pool), {
    migrationsFolder: new URL('../src/server/db/migrations', import.meta.url)
      .pathname,
  })
  console.log('Database migrations applied.')
} finally {
  await pool.end()
}
