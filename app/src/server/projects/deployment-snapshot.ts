import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

import { config } from '@/server/config'

export type DeploymentSnapshotRoute = {
  host: string
  service: string
  port: number
  path: string
  https: boolean
  stripPrefix: boolean
}

export type DeploymentSnapshotEnvVar = {
  key: string
  value: string
}

export type DeploymentCommitMeta = {
  message: string | null
  authorName: string | null
  authoredAt: string | null
  url: string | null
}

export type DeploymentConfigSnapshot = {
  version: 1
  repo: {
    id: number | null
    fullName: string
    installationId: number | null
  }
  project: {
    id: string
    teamId: string | null
    name: string
  }
  environment: {
    id: string
    name: string
    slug: string
    branch: string
    color: string
    defaultHost: string | null
  }
  server: {
    id: string
    name: string
    status: string | null
  }
  compose: {
    path: string
    projectName: string
    releaseCommand: string | null
    releaseService: string
    readinessPath: string | null
    routes: Array<DeploymentSnapshotRoute>
  }
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

export function encryptDeploymentEnvVars(
  envVars: Array<DeploymentSnapshotEnvVar>,
) {
  return encryptJson(envVars)
}

export function decryptDeploymentEnvVars(
  payload: string,
): Array<DeploymentSnapshotEnvVar> {
  const value = decryptJson(payload)

  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (item): item is DeploymentSnapshotEnvVar =>
      typeof item === 'object' &&
      item !== null &&
      'key' in item &&
      'value' in item &&
      typeof item.key === 'string' &&
      typeof item.value === 'string',
  )
}

export function parseDeploymentConfigSnapshot(
  value: unknown,
): DeploymentConfigSnapshot | null {
  if (!isRecord(value) || value.version !== 1) {
    return null
  }

  const repo = value.repo
  const project = value.project
  const environment = value.environment
  const server = value.server
  const compose = value.compose

  if (
    !isRecord(repo) ||
    !isRecord(project) ||
    !isRecord(environment) ||
    !isRecord(server) ||
    !isRecord(compose) ||
    typeof repo.fullName !== 'string' ||
    typeof project.id !== 'string' ||
    typeof project.name !== 'string' ||
    typeof environment.id !== 'string' ||
    typeof environment.name !== 'string' ||
    typeof environment.slug !== 'string' ||
    typeof environment.branch !== 'string' ||
    typeof environment.color !== 'string' ||
    typeof server.id !== 'string' ||
    typeof compose.path !== 'string' ||
    typeof compose.projectName !== 'string' ||
    typeof compose.releaseService !== 'string' ||
    !Array.isArray(compose.routes)
  ) {
    return null
  }

  return {
    version: 1,
    repo: {
      id: typeof repo.id === 'number' ? repo.id : null,
      fullName: repo.fullName,
      installationId:
        typeof repo.installationId === 'number' ? repo.installationId : null,
    },
    project: {
      id: project.id,
      teamId: typeof project.teamId === 'string' ? project.teamId : null,
      name: project.name,
    },
    environment: {
      id: environment.id,
      name: environment.name,
      slug: environment.slug,
      branch: environment.branch,
      color: environment.color,
      defaultHost:
        typeof environment.defaultHost === 'string'
          ? environment.defaultHost
          : null,
    },
    server: {
      id: server.id,
      name: typeof server.name === 'string' ? server.name : '',
      status: typeof server.status === 'string' ? server.status : null,
    },
    compose: {
      path: compose.path,
      projectName: compose.projectName,
      releaseCommand:
        typeof compose.releaseCommand === 'string'
          ? compose.releaseCommand
          : null,
      releaseService: compose.releaseService,
      readinessPath:
        typeof compose.readinessPath === 'string'
          ? compose.readinessPath
          : null,
      routes: normalizeSnapshotRoutes(compose.routes),
    },
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

function normalizeSnapshotRoutes(
  value: unknown,
): Array<DeploymentSnapshotRoute> {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (item): item is DeploymentSnapshotRoute =>
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
