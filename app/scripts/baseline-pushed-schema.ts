import { readMigrationFiles } from 'drizzle-orm/migrator'
import { Pool } from 'pg'

if (process.env.DEVPUSH_CONFIRM_BASELINE !== '1') {
  throw new Error(
    'Set DEVPUSH_CONFIRM_BASELINE=1 after taking a database backup.',
  )
}

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://devpush:devpush@localhost:7543/devpush'
const migrationsFolder = new URL('../src/server/db/migrations', import.meta.url)
  .pathname
const migrations = readMigrationFiles({ migrationsFolder })
const baseline = migrations.at(5)

if (!baseline) {
  throw new Error('Migration 0005 is missing.')
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 })

try {
  const schema = await pool.query<{ ready: boolean }>(`
    SELECT
      to_regclass('public.servers') IS NOT NULL
      AND to_regclass('public.server_availability_windows') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'server_metrics'
          AND column_name = 'disk_write_bytes_per_second'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'agent_runtime_observations'
          AND column_name = 'services'
      ) AS ready
  `)
  if (!schema.rows[0]?.ready) {
    throw new Error(
      'The database does not match the schema expected before migration 0006.',
    )
  }

  await pool.query('CREATE SCHEMA IF NOT EXISTS drizzle')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `)
  const existing = await pool.query(
    'SELECT id FROM drizzle.__drizzle_migrations LIMIT 1',
  )
  if (existing.rowCount) {
    throw new Error('Migration history already exists; refusing to baseline.')
  }
  await pool.query(
    'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
    [baseline.hash, baseline.folderMillis],
  )
  console.log('Recorded the pushed schema at migration 0005.')
} finally {
  await pool.end()
}
