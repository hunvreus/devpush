import { z } from 'zod'

import packageMetadata from '../../package.json'

function normalizeOptional(value: unknown) {
  if (value === '') {
    return undefined
  }

  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return value
}

const optionalString = z.preprocess(
  normalizeOptional,
  z.string().min(1).optional(),
)
const optionalUrl = z.preprocess(normalizeOptional, z.string().url().optional())
const optionalEmail = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().email().optional(),
)
const envBoolean = z.preprocess(
  (value) => (typeof value === 'string' ? value.toLowerCase() : value),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
)

const envSchema = z
  .object({
    DEVPUSH_DATABASE_URL: optionalString,
    DEVPUSH_LOG_DATABASE_URL: optionalString,
    DEVPUSH_DATABASE_AUTH_TOKEN: optionalString,
    DEVPUSH_LOG_DATABASE_AUTH_TOKEN: optionalString,
    DEVPUSH_DATABASE_PATH: z.string().min(1).default('.data/devpush.sqlite'),
    DEVPUSH_LOG_DATABASE_PATH: z.string().min(1).default('.data/logs.sqlite'),
    BETTER_AUTH_SECRET: z.string().min(1).default('dev-secret-change-me'),
    DEVPUSH_BASE_URL: z.string().url().default('http://localhost:7429'),
    BETTER_AUTH_URL: optionalUrl,
    DEVPUSH_ADMIN_EMAIL: optionalEmail,
    EMAIL_FROM: optionalString,
    RESEND_API_KEY: optionalString,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GITHUB_APP_CLIENT_ID: optionalString,
    GITHUB_APP_CLIENT_SECRET: optionalString,
    GITHUB_APP_ID: optionalString,
    GITHUB_APP_NAME: optionalString,
    GITHUB_APP_PRIVATE_KEY: optionalString,
    GITHUB_APP_WEBHOOK_SECRET: optionalString,
    DEVPUSH_SMOKE_GITHUB_TOKEN: optionalString,
    DEVPUSH_AGENT_BINARY_DIR: optionalString,
    DEVPUSH_RECOMMENDED_AGENT_VERSION: optionalString,
    DEVPUSH_STORAGE_ENDPOINT: optionalString,
    DEVPUSH_STORAGE_REGION: optionalString,
    DEVPUSH_STORAGE_BUCKET: optionalString,
    DEVPUSH_STORAGE_ACCESS_KEY_ID: optionalString,
    DEVPUSH_STORAGE_SECRET_ACCESS_KEY: optionalString,
    DEVPUSH_VERSION_FILE: optionalString,
    DEVPUSH_CRON_SECRET: optionalString,
    DEVPUSH_BACKUPS_ENABLED: envBoolean.default(false),
    DEVPUSH_AGENT_AUTO_UPDATE: envBoolean.default(false),
    DEVPUSH_TRUST_PROXY: envBoolean.default(false),
    DEVPUSH_MONITORING_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(2)
      .max(3650)
      .default(7),
    DEVPUSH_SECRET_ENCRYPTION_KEY: optionalString,
    DEVPUSH_TRAEFIK_EMAIL: optionalEmail,
  })
  .superRefine((value, context) => {
    const storageValues = [
      value.DEVPUSH_STORAGE_ENDPOINT,
      value.DEVPUSH_STORAGE_BUCKET,
      value.DEVPUSH_STORAGE_ACCESS_KEY_ID,
      value.DEVPUSH_STORAGE_SECRET_ACCESS_KEY,
    ]

    if (storageValues.some(Boolean) && storageValues.some((item) => !item)) {
      context.addIssue({
        code: 'custom',
        path: ['DEVPUSH_STORAGE_ENDPOINT'],
        message:
          'Endpoint, bucket, access key ID, and secret access key are all required for object storage.',
      })
    }
  })
  .transform((value) => ({
    ...value,
    BETTER_AUTH_URL: value.BETTER_AUTH_URL ?? value.DEVPUSH_BASE_URL,
  }))

export function parseConfig(env: NodeJS.ProcessEnv) {
  return envSchema.parse(env)
}

export function assertRuntimeSecurity(value: ReturnType<typeof parseConfig>) {
  const hostname = new URL(value.DEVPUSH_BASE_URL).hostname
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === 'host.lima.internal' ||
    hostname.endsWith('.localhost')

  if (isLocal) {
    return
  }

  if (
    value.BETTER_AUTH_SECRET === 'dev-secret-change-me' ||
    value.BETTER_AUTH_SECRET.startsWith('replace-with-') ||
    value.BETTER_AUTH_SECRET.length < 32
  ) {
    throw new Error(
      'BETTER_AUTH_SECRET must be a generated secret with at least 32 characters.',
    )
  }

  if (!value.DEVPUSH_SECRET_ENCRYPTION_KEY) {
    throw new Error('DEVPUSH_SECRET_ENCRYPTION_KEY is required.')
  }

  if (value.DEVPUSH_SECRET_ENCRYPTION_KEY.length < 32) {
    throw new Error(
      'DEVPUSH_SECRET_ENCRYPTION_KEY must contain at least 32 characters.',
    )
  }

  if (value.DEVPUSH_SECRET_ENCRYPTION_KEY.startsWith('replace-with-')) {
    throw new Error(
      'DEVPUSH_SECRET_ENCRYPTION_KEY must be a generated secret, not an example placeholder.',
    )
  }

  if (value.DEVPUSH_SECRET_ENCRYPTION_KEY === value.BETTER_AUTH_SECRET) {
    throw new Error(
      'DEVPUSH_SECRET_ENCRYPTION_KEY must differ from BETTER_AUTH_SECRET.',
    )
  }

  if (
    value.DEVPUSH_CRON_SECRET &&
    (value.DEVPUSH_CRON_SECRET.length < 32 ||
      value.DEVPUSH_CRON_SECRET.startsWith('replace-with-'))
  ) {
    throw new Error(
      'DEVPUSH_CRON_SECRET must be a generated secret with at least 32 characters.',
    )
  }

  if (value.DEVPUSH_CRON_SECRET === value.BETTER_AUTH_SECRET) {
    throw new Error('DEVPUSH_CRON_SECRET must differ from BETTER_AUTH_SECRET.')
  }
}

export const config = parseConfig(process.env)

export const currentAgentVersion = packageMetadata.version
