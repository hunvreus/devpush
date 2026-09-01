import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const configPath = resolve(
  process.cwd(),
  process.env.DEVPUSH_WRANGLER_CONFIG || 'wrangler.jsonc',
)
const secretsPath = resolve(process.cwd(), '.cloudflare-secrets.json')
const source = await readFile(configPath, 'utf8').catch(() => {
  throw new Error('Run `pnpm configure` to generate app/wrangler.jsonc.')
})
const config = JSON.parse(source)
const hyperdriveId = config.hyperdrive?.find(
  (item) => item.binding === 'DEVPUSH_DATABASE',
)?.id
const bucketName = config.r2_buckets?.find(
  (item) => item.binding === 'DEVPUSH_OBJECTS',
)?.bucket_name

if (!hyperdriveId || /^0+$/.test(hyperdriveId)) {
  throw new Error(
    'Run `pnpm configure` to configure the DEVPUSH_DATABASE Hyperdrive binding.',
  )
}

if (!bucketName) {
  throw new Error(
    'Run `pnpm configure` to configure the DEVPUSH_OBJECTS R2 bucket binding.',
  )
}

const secrets = JSON.parse(
  await readFile(secretsPath, 'utf8').catch(() => {
    throw new Error('Run `pnpm configure` to generate Cloudflare secrets.')
  }),
)
const values = { ...config.vars, ...secrets }
const missingSecrets = [
  'BETTER_AUTH_SECRET',
  'DEVPUSH_SECRET_ENCRYPTION_KEY',
].filter((key) => typeof values[key] !== 'string' || !values[key])

if (missingSecrets.length > 0) {
  throw new Error(
    `Cloudflare secrets are missing: ${missingSecrets.join(', ')}. Re-run \`pnpm configure\`.`,
  )
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

if (
  config.vars?.DEVPUSH_ADMIN_EMAIL &&
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.vars.DEVPUSH_ADMIN_EMAIL)
) {
  throw new Error('DEVPUSH_ADMIN_EMAIL must be a valid email address.')
}

console.log(
  `Cloudflare bindings configured: Hyperdrive ${hyperdriveId}, R2 ${bucketName}.`,
)
