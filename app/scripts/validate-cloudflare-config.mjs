import { remoteDatabaseConfig } from '../src/server/db/remote-config.ts'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse, printParseErrorCode } from 'jsonc-parser'

import { getD1Bindings } from '../../scripts/d1-config.mjs'
import { validateMcpUrl } from '../../scripts/setup-config.mjs'

const configPath = resolve(
  process.cwd(),
  process.env.DEVPUSH_WRANGLER_CONFIG || 'wrangler.jsonc',
)
const secretsPath = resolve(
  process.cwd(),
  process.env.DEVPUSH_CLOUDFLARE_SECRETS_FILE || '.cloudflare-secrets.json',
)
const source = await readFile(configPath, 'utf8').catch(() => {
  throw new Error('Run `pnpm configure` to generate app/wrangler.jsonc.')
})
const parseErrors = []
const config = parse(source, parseErrors, { allowTrailingComma: true })

if (parseErrors.length > 0) {
  const error = parseErrors[0]
  throw new Error(
    `Could not parse ${configPath}: ${printParseErrorCode(error.error)} at offset ${error.offset}.`,
  )
}
const bucketName = config.r2_buckets?.find(
  (item) => item.binding === 'DEVPUSH_OBJECTS',
)?.bucket_name

const secrets = JSON.parse(
  await readFile(secretsPath, 'utf8').catch(() => {
    throw new Error('Run `pnpm configure` to generate Cloudflare secrets.')
  }),
)
const values = { ...config.vars, ...secrets }
const remote = remoteDatabaseConfig(values)
const bindings = remote ? [] : getD1Bindings(config)
const missingSecrets = [
  'BETTER_AUTH_SECRET',
  'DEVPUSH_SECRET_ENCRYPTION_KEY',
].filter((key) => typeof values[key] !== 'string' || !values[key])

if (missingSecrets.length > 0) {
  throw new Error(
    `Cloudflare secrets are missing: ${missingSecrets.join(', ')}. Re-run \`pnpm configure\`.`,
  )
}

requireGeneratedSecret('BETTER_AUTH_SECRET', secrets.BETTER_AUTH_SECRET)
requireGeneratedSecret(
  'DEVPUSH_SECRET_ENCRYPTION_KEY',
  secrets.DEVPUSH_SECRET_ENCRYPTION_KEY,
)
if (secrets.BETTER_AUTH_SECRET === secrets.DEVPUSH_SECRET_ENCRYPTION_KEY) {
  throw new Error(
    'DEVPUSH_SECRET_ENCRYPTION_KEY must differ from BETTER_AUTH_SECRET.',
  )
}
if (secrets.DEVPUSH_CRON_SECRET !== undefined) {
  requireGeneratedSecret('DEVPUSH_CRON_SECRET', secrets.DEVPUSH_CRON_SECRET)
  if (secrets.DEVPUSH_CRON_SECRET === secrets.BETTER_AUTH_SECRET) {
    throw new Error('DEVPUSH_CRON_SECRET must differ from BETTER_AUTH_SECRET.')
  }
}

if (typeof config.vars?.DEVPUSH_BASE_URL !== 'string') {
  throw new Error(
    'Cloudflare configuration is missing DEVPUSH_BASE_URL. Re-run `pnpm configure`.',
  )
}

for (const key of ['DEVPUSH_BASE_URL', 'BETTER_AUTH_URL']) {
  const value = config.vars?.[key]
  if (value === undefined) continue
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${key} must be a valid URL in the generated config.`)
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${key} must be an HTTP(S) origin without a path.`)
  }
}
if (values.DEVPUSH_MCP_URL !== undefined && values.DEVPUSH_MCP_URL !== '') {
  const error = validateMcpUrl(values.DEVPUSH_MCP_URL)
  if (error) throw new Error(`DEVPUSH_MCP_URL: ${error}`)
}

if (
  config.vars?.DEVPUSH_ADMIN_EMAIL &&
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.vars.DEVPUSH_ADMIN_EMAIL)
) {
  throw new Error('DEVPUSH_ADMIN_EMAIL must be a valid email address.')
}

console.log(
  `Cloudflare bindings configured: ${remote ? 'remote libSQL (main and logs)' : `D1 ${bindings.map((item) => item.database_name).join(' and ')}`}, R2 ${bucketName || 'disabled (image uploads unavailable)'}.`,
)

function requireGeneratedSecret(name, value) {
  if (
    typeof value !== 'string' ||
    value.length < 32 ||
    value.startsWith('replace-with-') ||
    value === 'dev-secret-change-me'
  ) {
    throw new Error(
      `${name} must be a generated secret of at least 32 characters.`,
    )
  }
}
