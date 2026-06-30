import { z } from 'zod'

const optionalString = z.preprocess((value) => {
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
}, z.string().min(1).optional())
const optionalEmail = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().email().optional(),
)

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://devpush:devpush@localhost:7543/devpush'),
  BETTER_AUTH_SECRET: z.string().min(1).default('dev-secret-change-me'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:7429'),
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
  DEVPUSH_VERSION_FILE: optionalString,
  DEVPUSH_TRAEFIK_EMAIL: optionalEmail,
  DEVPUSH_DEFAULT_APP_DOMAIN: z
    .string()
    .trim()
    .min(1)
    .regex(/^[^\s/]+$/, 'Use a domain name without protocol or path.')
    .default('devpush.app'),
})

export const config = envSchema.parse(process.env)
