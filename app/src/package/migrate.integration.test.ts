import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import Sqlite from 'better-sqlite3'
import { expect, test } from 'vitest'

test('the Docker maintenance bundle finds application migrations and reruns safely', async () => {
  const app = fileURLToPath(new URL('../..', import.meta.url))
  mkdirSync(resolve(app, '.tmp'), { recursive: true })
  const fixture = mkdtempSync(resolve(app, '.tmp/maintenance-migrate-'))
  try {
    for (const directory of ['migrations-sqlite', 'migrations-logs'])
      cpSync(
        resolve(app, 'src/server/db', directory),
        resolve(fixture, 'src/server/db', directory),
        { recursive: true },
      )
    const outfile = resolve(fixture, '.maintenance/migrate.mjs')
    await build({
      entryPoints: [resolve(app, 'scripts/migrate.ts')],
      outfile,
      bundle: true,
      external: ['better-sqlite3'],
      platform: 'node',
      format: 'esm',
      target: 'node22',
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    })
    const main = resolve(fixture, 'main.sqlite')
    const logs = resolve(fixture, 'logs.sqlite')
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, [outfile], {
        cwd: fixture,
        encoding: 'utf8',
        env: {
          NODE_ENV: 'production',
          DEVPUSH_DATABASE_PATH: main,
          DEVPUSH_LOG_DATABASE_PATH: logs,
        },
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
    }
    for (const [path, table] of [
      [main, 'teams'],
      [logs, 'runtime_logs'],
    ] as const) {
      const db = new Sqlite(path, { readonly: true })
      try {
        expect(
          db.prepare('select name from sqlite_master where name=?').get(table),
        ).toBeTruthy()
        expect(
          db.prepare('select hash from __drizzle_migrations').all().length,
        ).toBeGreaterThan(0)
      } finally {
        db.close()
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
