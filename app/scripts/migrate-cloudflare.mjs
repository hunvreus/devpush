import { remoteDatabaseConfig } from '../src/server/db/remote-config.ts'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'jsonc-parser'
import { getD1Bindings } from '../../scripts/d1-config.mjs'

const appDir = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
let local = false
if (args.includes('--local') && args.includes('--remote'))
  throw new Error('Choose either --local or --remote.')
let configPath = process.env.DEVPUSH_WRANGLER_CONFIG || 'wrangler.jsonc'
let persistTo
for (let index = 0; index < args.length; index++) {
  const arg = args[index]
  if (arg === '--local') local = true
  else if (arg === '--remote') local = false
  else if (arg === '--config' || arg === '--persist-to') {
    const value = args[++index]
    if (!value || value.startsWith('--'))
      throw new Error(`${arg} needs a path.`)
    if (arg === '--config') configPath = value
    else persistTo = resolve(value)
  } else throw new Error(`Unknown migration option: ${arg}`)
}
if (persistTo && !local) throw new Error('--persist-to requires --local.')
configPath = resolve(appDir, configPath)
const errors = []
const config = parse(readFileSync(configPath, 'utf8'), errors, {
  allowTrailingComma: true,
})
if (errors.length) throw new Error('Cannot parse the Wrangler configuration.')
const secretsPath = resolve(
  appDir,
  process.env.DEVPUSH_CLOUDFLARE_SECRETS_FILE || '.cloudflare-secrets.json',
)
let secrets = {}
try {
  secrets = JSON.parse(readFileSync(secretsPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const values = { ...config.vars, ...secrets }
const remote = remoteDatabaseConfig(values)
if (remote) {
  if (local)
    throw new Error(
      '--local is only for D1. Remote libSQL URLs always connect to the configured databases.',
    )
  const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/migrate.ts'], {
    cwd: appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...values,
      DEVPUSH_DATABASE_AUTH_TOKEN: remote.main.authToken || '',
      DEVPUSH_LOG_DATABASE_AUTH_TOKEN: remote.logs.authToken || '',
    },
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
const bindings = getD1Bindings(config, { local })
for (const binding of bindings) {
  const command = [
    'exec',
    'wrangler',
    'd1',
    'migrations',
    'apply',
    binding.binding,
    '--config',
    configPath,
    local ? '--local' : '--remote',
    ...(persistTo ? ['--persist-to', persistTo] : []),
  ]
  const result = spawnSync('pnpm', command, { cwd: appDir, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
