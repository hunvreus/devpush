import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import Sqlite from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { smokeMcp } from './smoke-mcp.mjs'
import { smokeSettings } from './smoke-settings.mjs'
import { smokeAssets } from './smoke-assets.mjs'
import { smokePlugins } from './smoke-plugins.mjs'
import { smokePluginServices } from './smoke-plugin-services.mjs'

const development = process.env.DEVPUSH_SMOKE_DEVELOPMENT === '1'
const sourceDevelopment = development && !process.env.DEVPUSH_SMOKE_APP_DIR
const appDir = resolve(
  process.env.DEVPUSH_SMOKE_APP_DIR ||
    fileURLToPath(new URL('../', import.meta.url)),
)
const packageDir = process.env.DEVPUSH_SMOKE_APP_DIR
  ? realpathSync(resolve(appDir, 'node_modules/devpush'))
  : appDir
mkdirSync(resolve(appDir, '.tmp'), { recursive: true })
const directory = mkdtempSync(resolve(appDir, '.tmp/node-smoke-'))
const mainPath = resolve(directory, 'main.sqlite')
const logsPath = resolve(directory, 'logs.sqlite')
const stores = [new Sqlite(mainPath), new Sqlite(logsPath)]
for (const [index, store] of stores.entries()) {
  store.pragma('foreign_keys = ON')
  store.pragma('journal_mode = WAL')
  if (!sourceDevelopment)
    migrate(drizzle(store), {
      migrationsFolder: resolve(
        packageDir,
        'src/server/db',
        index === 0 ? 'migrations-sqlite' : 'migrations-logs',
      ),
    })
}
const listener = createServer()
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
const { port } = listener.address()
await new Promise((resolve, reject) =>
  listener.close((error) => (error ? reject(error) : resolve())),
)
const origin = `http://127.0.0.1:${port}`
const authSecret = randomBytes(32).toString('hex')
// Do not inherit .env or provider/storage credentials from the developer's
// app. This production process uses only disposable stores and generated keys.
const env = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: development ? 'development' : 'production',
  HOST: '127.0.0.1',
  PORT: String(port),
  DEVPUSH_BASE_URL: origin,
  BETTER_AUTH_URL: origin,
  DEVPUSH_MCP_URL: `${origin}/mcp`,
  BETTER_AUTH_SECRET: authSecret,
  DEVPUSH_DATABASE_URL: '',
  DEVPUSH_LOG_DATABASE_URL: '',
  DEVPUSH_DATABASE_AUTH_TOKEN: '',
  DEVPUSH_LOG_DATABASE_AUTH_TOKEN: '',
  DEVPUSH_DATABASE_PATH: mainPath,
  DEVPUSH_LOG_DATABASE_PATH: logsPath,
  DEVPUSH_SECRET_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
}
let output = ''
const server = spawn(
  sourceDevelopment ? 'npm' : process.execPath,
  sourceDevelopment
    ? ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)]
    : development
      ? [
          './node_modules/vite/bin/vite.js',
          'dev',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort',
        ]
      : ['.output/server/index.mjs'],
  {
    cwd: appDir,
    env,
    detached: sourceDevelopment && process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
server.stdout.on('data', (chunk) => {
  output += chunk
})
server.stderr.on('data', (chunk) => {
  output += chunk
})
try {
  for (let attempt = 0; ; attempt++) {
    try {
      assert.equal(
        (
          await fetch(`${origin}/api/health`, {
            signal: AbortSignal.timeout(2000),
          })
        ).status,
        200,
      )
      break
    } catch (error) {
      if (attempt === 79 || server.exitCode !== null) throw error
      await delay(250)
    }
  }
  if (sourceDevelopment) {
    assert.ok(
      stores[0]
        .prepare('pragma table_info(user)')
        .all()
        .some((column) => column.name === 'profile_confirmed_at'),
    )
    for (const [index, store] of stores.entries()) {
      const migrations = readMigrationFiles({
        migrationsFolder: resolve(
          packageDir,
          'src/server/db',
          index === 0 ? 'migrations-sqlite' : 'migrations-logs',
        ),
      })
      assert.deepEqual(
        store
          .prepare('select hash from __drizzle_migrations order by created_at')
          .all()
          .map((row) => row.hash),
        migrations.map((migration) => migration.hash),
      )
    }
    console.log(
      'Development startup: all main/log migrations applied before serving requests.',
    )
  }
  const login = await fetch(`${origin}/auth/login`)
  assert.equal(login.status, 200)
  await smokeAssets(origin, await login.text())
  await smokePlugins(origin)
  const settings = await fetch(`${origin}/settings`)
  assert.equal(settings.status, 200)
  assert.match(await settings.text(), /data-slot="skeleton"/)
  await smokeSettings({
    origin,
    authSecret,
    appDir,
    development,
    modulePrefix: process.env.DEVPUSH_SMOKE_APP_DIR
      ? `@fs/${packageDir}/src`
      : 'src',
    query: async (index, sql) => {
      const statement = stores[index].prepare(sql)
      if (statement.reader) return statement.all()
      statement.run()
      return []
    },
  })
  await smokePluginServices({
    origin,
    authSecret,
    appDir,
    development,
    modulePrefix: process.env.DEVPUSH_SMOKE_APP_DIR
      ? `@fs/${packageDir}/src`
      : 'src',
    query: async (index, sql) => {
      const statement = stores[index].prepare(sql)
      if (statement.reader) return statement.all()
      statement.run()
      return []
    },
  })
  if (!development)
    await smokeMcp({
      origin,
      authSecret,
      supportsCimd: true,
      appDir,
      query: async (index, sql) => {
        const statement = stores[index].prepare(sql)
        if (statement.reader) return statement.all()
        statement.run()
        return []
      },
    })
  console.log(
    development
      ? 'Vite development: login, settings pending UI and concurrent settings saves passed.'
      : 'Node production: login, settings pending UI, REST, SDK2026 MCP, OAuth consent, grant revocation and refresh replay passed.',
  )
} catch (error) {
  console.error(output)
  throw error
} finally {
  writeFileSync(resolve(directory, 'server.log'), output)
  if (server.exitCode === null) {
    const closed = once(server, 'exit')
    if (sourceDevelopment && process.platform !== 'win32')
      process.kill(-server.pid, 'SIGTERM')
    else server.kill('SIGTERM')
    await closed
  }
  stores.forEach((store) => store.close())
}
