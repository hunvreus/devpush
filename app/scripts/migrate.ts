import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://devpush:devpush@localhost:7543/devpush'

const pool = new Pool({ connectionString: databaseUrl, max: 1 })

try {
  const state = await pool.query<{
    has_history: boolean
    has_schema: boolean
  }>(`
    SELECT
      to_regclass('public.servers') IS NOT NULL AS has_schema,
      to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_history
  `)
  const hasMigration = state.rows[0]?.has_history
    ? Number(
        (
          await pool.query<{ count: string }>(
            'SELECT count(*) AS count FROM drizzle.__drizzle_migrations',
          )
        ).rows[0]?.count ?? 0,
      ) > 0
    : false
  if (state.rows[0]?.has_schema && !hasMigration) {
    throw new Error(
      'This database predates explicit migrations. Back it up, then run DEVPUSH_CONFIRM_BASELINE=1 pnpm --dir app db:baseline once.',
    )
  }
  await migrate(drizzle(pool), {
    migrationsFolder: new URL('../src/server/db/migrations', import.meta.url)
      .pathname,
  })
  console.log('Database migrations applied.')
} finally {
  await pool.end()
}
