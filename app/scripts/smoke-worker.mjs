import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { parse } from 'jsonc-parser'
import { createClient } from '@libsql/client/web'

const appDir = fileURLToPath(new URL('../', import.meta.url))
const driver = process.argv[2]
if (!['d1', 'libsql'].includes(driver)) throw new Error('Choose d1 or libsql.')
mkdirSync(resolve(appDir, '.tmp'), { recursive: true })
const directory = mkdtempSync(resolve(appDir, '.tmp/worker-smoke-'))
const configPath = resolve(directory, 'wrangler.jsonc')
const secretsPath = resolve(directory, 'secrets.json')
const statePath = resolve(directory, 'state')
const listener = createServer()
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
const { port } = listener.address()
await new Promise((resolve, reject) =>
  listener.close((error) => (error ? reject(error) : resolve())),
)
const origin = `http://127.0.0.1:${port}`
const config = parse(
  readFileSync(resolve(appDir, 'wrangler.template.jsonc'), 'utf8'),
)
config.main = resolve(appDir, 'src/server.ts')
config.vars = {
  DEVPUSH_BASE_URL: origin,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: 'worker-smoke-auth-secret-over-thirty-two-characters',
  EMAIL_FROM: 'Smoke <smoke@example.invalid>',
  RESEND_API_KEY: 're_worker_smoke_invalid_key',
  DEVPUSH_SECRET_ENCRYPTION_KEY:
    'worker-smoke-encryption-key-over-thirty-two-characters',
}
config.r2_buckets = [
  { binding: 'DEVPUSH_OBJECTS', bucket_name: 'worker-smoke-objects' },
]
const clients = []
if (driver === 'libsql') {
  delete config.d1_databases
  for (const [key, fallback] of [
    ['DEVPUSH_DATABASE_URL', 'http://127.0.0.1:7561'],
    ['DEVPUSH_LOG_DATABASE_URL', 'http://127.0.0.1:7562'],
  ]) {
    const url = process.env[key] || fallback
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
      throw new Error(
        'Worker smoke tests require disposable loopback libSQL servers.',
      )
    config.vars[key] = url
    clients.push(createClient({ url }))
  }
} else {
  for (const binding of config.d1_databases)
    binding.migrations_dir = resolve(appDir, binding.migrations_dir)
}
writeFileSync(configPath, JSON.stringify(config))
writeFileSync(secretsPath, '{}')
const env = {
  ...process.env,
  DEVPUSH_WRANGLER_CONFIG: configPath,
  DEVPUSH_CLOUDFLARE_SECRETS_FILE: secretsPath,
}
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: appDir,
    env,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.stderr || result.status}`,
    )
  return result.stdout
}
function d1(index, sql) {
  const output = run(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      index === 0 ? 'DEVPUSH_DATABASE' : 'DEVPUSH_LOG_DATABASE',
      '--local',
      '--config',
      configPath,
      '--persist-to',
      statePath,
      '--command',
      sql,
      '--json',
    ],
    true,
  )
  return JSON.parse(output)[0].results
}
async function query(index, sql) {
  return driver === 'd1'
    ? d1(index, sql)
    : (await clients[index].execute(sql)).rows
}
let worker
let output = ''
try {
  for (const client of clients) {
    for (let attempt = 0; ; attempt++) {
      try {
        await client.execute('select 1')
        break
      } catch (error) {
        if (attempt === 39) throw error
        await delay(250)
      }
    }
  }
  run('pnpm', [
    'db:migrate:cloudflare',
    ...(driver === 'd1' ? ['--local', '--persist-to', statePath] : []),
  ])
  run('pnpm', ['build:cloudflare'])
  await query(
    0,
    "insert into rate_limits(key,count,reset_at) values('worker-smoke-expired',1,0)",
  )
  await query(
    1,
    "insert into runtime_logs(id,project_id,environment_id,server_id,runtime_id,service,observed_at,content,search_content,content_hash) values('worker-smoke-expired','p','e','s','r','web',0,'old','old','worker-smoke-hash')",
  )
  worker = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--config',
      'dist/server/wrangler.json',
      '--persist-to',
      statePath,
      '--port',
      String(port),
      '--test-scheduled',
    ],
    {
      cwd: appDir,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  worker.stdout.on('data', (chunk) => {
    output += chunk
  })
  worker.stderr.on('data', (chunk) => {
    output += chunk
  })
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(3000),
      })
      assert.equal(response.status, 200)
      break
    } catch (error) {
      if (attempt === 79 || worker.exitCode !== null) throw error
      await delay(250)
    }
  }
  assert.equal((await fetch(`${origin}/auth/login`)).status, 200)
  // Authenticated routes render a public skeleton without waiting for session/DB
  // loaders; client server-functions still enforce authorization when hydrated.
  for (const path of [
    '/smoke-team',
    '/smoke-team/projects/demo/settings',
    '/settings',
    '/admin',
  ]) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual' })
    assert.equal(
      response.status,
      200,
      `Expected an immediate pending document for ${path}`,
    )
    const html = await response.text()
    assert.match(
      html,
      /data-slot="skeleton"/,
      `Missing pending layout for ${path}`,
    )
  }
  // Exercise auth writes without sending an email: rate limiting runs before
  // Better Auth rejects the malformed address.
  const invalidEmail = await fetch(
    `${origin}/api/auth/email-otp/send-verification-otp`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: 'invalid-email', type: 'sign-in' }),
    },
  )
  assert.equal(invalidEmail.status, 400, await invalidEmail.text())
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => fetch(`${origin}/api/health`)),
  )
  assert(responses.every((response) => response.status === 200))
  await Promise.all(responses.map((response) => response.arrayBuffer()))
  const time = Math.floor(Date.now() / 3_600_000) * 3_600_000
  assert.equal(
    (
      await fetch(
        `${origin}/cdn-cgi/local/scheduled?cron=0+*+*+*+*&time=${time}`,
      )
    ).status,
    200,
  )
  for (let attempt = 0; ; attempt++) {
    const main = await query(
      0,
      "select count(*) as n from rate_limits where key='worker-smoke-expired'",
    )
    const logs = await query(
      1,
      "select count(*) as n from runtime_logs where id='worker-smoke-expired'",
    )
    if (main[0].n === 0 && logs[0].n === 0) break
    if (attempt === 19)
      throw new Error('Scheduled cleanup did not update both stores.')
    await delay(250)
  }
  console.log(
    `Worker ${driver}: login, concurrent health requests and main/log scheduled cleanup passed.`,
  )
} catch (error) {
  console.error(output)
  throw error
} finally {
  writeFileSync(resolve(directory, 'worker.log'), output)
  if (worker && worker.exitCode === null) {
    if (process.platform === 'win32') worker.kill('SIGTERM')
    else process.kill(-worker.pid, 'SIGTERM')
    await new Promise((resolve) => worker.once('exit', resolve))
  }
  clients.forEach((client) => client.close())
}
