import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

import { config } from '@/server/config'

export type DeploymentRoute = {
  host: string
  service: string
  port: number
  path: string
  https: boolean
  stripPrefix: boolean
}

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

export type DeploymentConfig = {
  version: 2
  composePath: string
  releaseCommand: string | null
  releaseService: string
  readinessPath: string | null
  routes: Array<DeploymentRoute>
}

export function buildComposeProjectName({
  environmentId,
  projectId,
}: {
  environmentId: string
  projectId: string
}) {
  return `dp_${shortRuntimeId(projectId)}_${shortRuntimeId(environmentId)}`
}

export function encryptDeploymentEnvVars(envVars: Array<DeploymentEnvVar>) {
  return encryptJson(envVars)
}

export function decryptDeploymentEnvVars(
  payload: string,
): Array<DeploymentEnvVar> {
  const value = decryptJson(payload)

  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (item): item is DeploymentEnvVar =>
      typeof item === 'object' &&
      item !== null &&
      'key' in item &&
      'value' in item &&
      typeof item.key === 'string' &&
      typeof item.value === 'string',
  )
}

export function parseDeploymentConfig(value: unknown): DeploymentConfig | null {
  if (!isRecord(value) || value.version !== 2) {
    return null
  }

  if (
    typeof value.composePath !== 'string' ||
    typeof value.releaseService !== 'string' ||
    !Array.isArray(value.routes)
  ) {
    return null
  }

  return {
    version: 2,
    composePath: value.composePath,
    releaseCommand:
      typeof value.releaseCommand === 'string' ? value.releaseCommand : null,
    releaseService: value.releaseService,
    readinessPath:
      typeof value.readinessPath === 'string' ? value.readinessPath : null,
    routes: normalizeRoutes(value.routes),
  }
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

function normalizeRoutes(value: unknown): Array<DeploymentRoute> {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (item): item is DeploymentRoute =>
        isRecord(item) &&
        typeof item.host === 'string' &&
        typeof item.service === 'string' &&
        typeof item.port === 'number' &&
        typeof item.path === 'string' &&
        typeof item.https === 'boolean',
    )
    .map((route) => ({
      ...route,
      stripPrefix:
        typeof route.stripPrefix === 'boolean' ? route.stripPrefix : false,
    }))
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

function shortRuntimeId(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '')

  if (normalized.length >= 10) {
    return normalized.slice(0, 10)
  }

  return normalized.padEnd(10, '0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
