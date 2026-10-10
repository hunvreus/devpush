import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

const directories: string[] = []
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
)
function fixture(vars: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'devpush-worker-config-'))
  directories.push(directory)
  const config = join(directory, 'wrangler.json')
  const secrets = join(directory, 'secrets.json')
  writeFileSync(
    config,
    JSON.stringify({
      r2_buckets: [{ binding: 'DEVPUSH_OBJECTS', bucket_name: 'objects' }],
      vars: { DEVPUSH_BASE_URL: 'https://devpush.example', ...vars },
    }),
  )
  writeFileSync(
    secrets,
    JSON.stringify({
      BETTER_AUTH_SECRET: 'test-auth-secret-longer-than-thirty-two-characters',
      DEVPUSH_SECRET_ENCRYPTION_KEY:
        'test-encryption-key-longer-than-thirty-two-characters',
    }),
  )
  return {
    ...process.env,
    DEVPUSH_WRANGLER_CONFIG: config,
    DEVPUSH_CLOUDFLARE_SECRETS_FILE: secrets,
  }
}
const remote = {
  DEVPUSH_DATABASE_URL: 'https://main.example',
  DEVPUSH_LOG_DATABASE_URL: 'https://logs.example',
}

test('Cloudflare preflight accepts remote URLs without D1 resources', () => {
  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/validate-cloudflare-config.mjs'],
    { env: fixture(remote), encoding: 'utf8' },
  )
  expect(output).toContain('remote libSQL (main and logs)')
})

test('Cloudflare preflight rejects incomplete remote configuration', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/validate-cloudflare-config.mjs'],
    {
      env: fixture({ DEVPUSH_DATABASE_URL: remote.DEVPUSH_DATABASE_URL }),
      encoding: 'utf8',
    },
  )
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Configure both DEVPUSH_DATABASE_URL')
})

test('local migrations cannot accidentally contact configured remote libSQL databases', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/migrate-cloudflare.mjs', '--local'],
    {
      env: fixture(remote),
      encoding: 'utf8',
    },
  )
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('--local is only for D1')
})
