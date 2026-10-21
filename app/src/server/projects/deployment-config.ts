import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { z } from 'zod'

import { config } from '@/server/config'
import { projectRuntimeConfigSchema } from '@/lib/project-runtime-config'

const deploymentRouteSchema = z.strictObject({
  host: z.string().min(1),
  service: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  path: z.string().regex(/^\//),
  https: z.boolean(),
  stripPrefix: z.boolean(),
})

const deploymentConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runtime: projectRuntimeConfigSchema,
  routes: z.array(deploymentRouteSchema),
})

const deploymentEnvVarsSchema = z.array(
  z.strictObject({
    key: z.string(),
    value: z.string(),
  }),
)

export type DeploymentEnvVar = {
  key: string
  value: string
}

export type DeploymentCommitMeta = {
  message: string | null
  authorName: string | null
  authoredAt: string | null
  url: string | null
}

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>

export function encryptDeploymentEnvVars(envVars: Array<DeploymentEnvVar>) {
  return encryptJson(envVars)
}

export function decryptDeploymentEnvVars(
  payload: string,
): Array<DeploymentEnvVar> {
  return deploymentEnvVarsSchema.parse(decryptJson(payload))
}

export function parseDeploymentConfig(value: unknown): DeploymentConfig | null {
  const result = deploymentConfigSchema.safeParse(value)
  return result.success ? result.data : null
}

export function toDeploymentCommitMeta(commit: {
  message: string | null
  authorName?: string | null
  authoredAt?: string | null
  url?: string | null
}): DeploymentCommitMeta {
  return {
    message: commit.message,
    authorName: commit.authorName ?? null,
    authoredAt: commit.authoredAt ?? null,
    url: commit.url ?? null,
  }
}

export function normalizeDeploymentCommitMeta(
  value: unknown,
): DeploymentCommitMeta {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const record = value as Record<string, unknown>
    return {
      message: typeof record.message === 'string' ? record.message : null,
      authorName:
        typeof record.authorName === 'string' ? record.authorName : null,
      authoredAt:
        typeof record.authoredAt === 'string' ? record.authoredAt : null,
      url: typeof record.url === 'string' ? record.url : null,
    }
  }
  return { message: null, authorName: null, authoredAt: null, url: null }
}

function encryptJson(value: unknown) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

function decryptJson(payload: string): unknown {
  const [version, ivValue, tagValue, encryptedValue] = payload.split(':')

  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Invalid encrypted deployment payload.')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ])

  return JSON.parse(decrypted.toString('utf8'))
}

function encryptionKey() {
  return createHash('sha256').update(config.BETTER_AUTH_SECRET).digest()
}
