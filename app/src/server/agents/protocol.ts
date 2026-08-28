import { z } from 'zod'

import type {
  BackupCleanupJobPayload,
  BackupJobPayload,
  BackupRestoreJobPayload,
} from '@/server/backups/service'
import type { DeprovisionJobPayload } from './cleanup'
import {
  RequestBodyTooLargeError,
  readRequestText,
} from '@/server/http/request-body'

const maxAgentRequestBytes = 16 * 1024 * 1024
const maxDeploymentEvents = 100
const maxDeploymentLogLength = 66 * 1024
const maxDeploymentLogLines = 5_000
const maxRuntimeLogContentLength = 17 * 1024

const agentVersionSchema = z.string().trim().min(1).max(128)

export const agentMetadataSchema = z.object({
  agentVersion: agentVersionSchema.nullable().optional(),
  protocolVersion: z.number().int().positive().optional(),
  capabilities: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
})

const deploymentPhases = [
  'agent_connected',
  'config_synced',
  'repo_fetched',
  'compose_resolved',
  'lifecycle_command_started',
  'lifecycle_command_succeeded',
  'images_built_or_pulled',
  'release_command_started',
  'release_command_succeeded',
  'revision_started',
  'readiness_check_started',
  'traffic_switched',
  'old_revision_retired',
  'completed',
] as const

const deploymentPhaseSchema = z.enum(deploymentPhases)

export const deploymentEventSchema = z.object({
  phase: deploymentPhaseSchema,
  message: z.string().min(1).max(maxDeploymentLogLength),
})

const deploymentLogsSchema = z
  .array(z.string().max(maxDeploymentLogLength))
  .max(maxDeploymentLogLines)
const deploymentEventsSchema = z
  .array(deploymentEventSchema)
  .max(maxDeploymentEvents)

const agentCredentialsSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
})

export const nextAgentJobSchema =
  agentCredentialsSchema.merge(agentMetadataSchema)

export const agentJobStatusSchema = agentCredentialsSchema.extend({
  deploymentId: z.string().min(1),
})

export const agentJobProgressSchema = agentCredentialsSchema.extend({
  deploymentId: z.string().min(1),
  logStartSeq: z.number().int().positive(),
  logs: deploymentLogsSchema,
  events: deploymentEventsSchema,
})

const completionStatusSchema = z.enum(['succeeded', 'failed', 'canceled'])

const completeDeploymentJobSchema = agentCredentialsSchema.extend({
  type: z.literal('deploy'),
  deploymentId: z.string().min(1),
  status: completionStatusSchema,
  gitSha: z.string().min(1).nullable(),
  logStartSeq: z.number().int().positive().optional(),
  logs: deploymentLogsSchema,
  events: deploymentEventsSchema,
})

const completeCleanupJobSchema = agentCredentialsSchema.extend({
  type: z.enum(['deprovision', 'purge']),
  jobId: z.string().min(1),
  status: completionStatusSchema,
  message: z.string().optional().nullable(),
})

const backupArtifactSchema = z.object({
  type: z.enum(['manifest', 'volume', 'database']),
  storage: z.enum(['local', 'remote']),
  objectKey: z.string().trim().min(1).max(1_024),
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(0),
})

const completeBackupJobSchema = agentCredentialsSchema.extend({
  type: z.literal('backup'),
  jobId: z.string().min(1),
  backupRunId: z.string().min(1),
  status: completionStatusSchema,
  message: z.string().optional().nullable(),
  manifest: z.unknown().optional(),
  artifacts: z.array(backupArtifactSchema).optional(),
})

const completeBackupCleanupJobSchema = agentCredentialsSchema.extend({
  type: z.literal('backup_cleanup'),
  jobId: z.string().min(1),
  backupRunIds: z.array(z.string().min(1)).min(1),
  status: completionStatusSchema,
  message: z.string().optional().nullable(),
})

const completeRestoreJobSchema = agentCredentialsSchema.extend({
  type: z.literal('restore'),
  jobId: z.string().min(1),
  status: completionStatusSchema,
  message: z.string().optional().nullable(),
})

export const completeAgentJobSchema = z.union([
  completeDeploymentJobSchema,
  completeCleanupJobSchema,
  completeBackupJobSchema,
  completeBackupCleanupJobSchema,
  completeRestoreJobSchema,
])

export const rotateAgentCredentialSchema =
  agentCredentialsSchema.merge(agentMetadataSchema)

export const registerAgentSchema = z
  .object({
    token: z.string().min(1),
  })
  .merge(agentMetadataSchema)

const runtimeLogSchema = z.object({
  runtimeId: z.string().min(1).max(128),
  service: z.string().min(1).max(128),
  observedAt: z.string().min(1),
  content: z.string().min(1).max(maxRuntimeLogContentLength),
})

export const runtimeLogsSchema = agentCredentialsSchema.extend({
  logs: z.array(runtimeLogSchema).max(500),
})

export const heartbeatSchema = agentCredentialsSchema
  .merge(agentMetadataSchema)
  .extend({
    runtimeIds: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
    runtimes: z
      .array(
        z.object({
          runtimeId: z.string().trim().min(1).max(128),
          services: z
            .array(
              z.object({
                name: z.string().trim().min(1).max(128),
                containerName: z.string().trim().min(1).max(256),
                state: z.string().trim().min(1).max(32),
                health: z.string().trim().max(32).nullable(),
                restartCount: z.number().int().min(0),
                startedAt: z.string().datetime().nullable(),
                exitCode: z.number().int(),
              }),
            )
            .max(500),
        }),
      )
      .max(200)
      .optional(),
    system: z
      .object({
        hostname: z.string().trim().min(1).max(255).optional(),
        operatingSystem: z.string().trim().min(1).max(255).optional(),
        kernelVersion: z.string().trim().min(1).max(255).optional(),
        architecture: z.string().trim().min(1).max(64).optional(),
        cpuCoreCount: z.number().int().min(1).max(4096).optional(),
        uptimeSeconds: z.number().int().min(0).optional(),
      })
      .optional(),
    metrics: z
      .object({
        cpuPercent: z.number().min(0).max(100).optional(),
        memoryUsedBytes: z.number().int().min(0).optional(),
        memoryTotalBytes: z.number().int().min(0).optional(),
        diskUsedBytes: z.number().int().min(0).optional(),
        diskTotalBytes: z.number().int().min(0).optional(),
        networkReceiveBytesPerSecond: z.number().min(0).optional(),
        networkTransmitBytesPerSecond: z.number().min(0).optional(),
        diskReadBytesPerSecond: z.number().min(0).optional(),
        diskWriteBytesPerSecond: z.number().min(0).optional(),
      })
      .optional(),
  })

type DeploymentEvent = z.infer<typeof deploymentEventSchema>

type AgentRoute = {
  host: string
  service: string
  port: number
  path: string
  https: boolean
  stripPrefix: boolean
}

export type AgentEnvVar = {
  key: string
  value: string
}

export type AgentDeployJob = {
  type: 'deploy'
  id: string
  logStartSeq: number
  repo: {
    fullName: string
    branch: string
    sha: string
    token: string
  }
  project: { name: string }
  runtime: {
    type: 'compose'
    path: string
    projectName: string
    action: 'deploy' | 'rollback'
    releaseCommand: string | null
    releaseService: string | null
    readinessPath: string | null
    deployCommand: string | null
    rollbackCommand: string | null
    timeoutSeconds: number
  }
  envVars: Array<AgentEnvVar>
  routes: Array<AgentRoute>
}

export type AgentCleanupJob = {
  type: 'deprovision' | 'purge'
  id: string
  cleanup: Omit<DeprovisionJobPayload, 'schemaVersion'>
}

export type AgentBackupJob = {
  type: 'backup'
  id: string
  backup: BackupJobPayload
}

export type AgentBackupCleanupJob = {
  type: 'backup_cleanup'
  id: string
  cleanup: BackupCleanupJobPayload
}

export type AgentRestoreJob = {
  type: 'restore'
  id: string
  restore: BackupRestoreJobPayload
}

export type AgentJob =
  | AgentDeployJob
  | AgentCleanupJob
  | AgentBackupJob
  | AgentBackupCleanupJob
  | AgentRestoreJob

export type AgentJobCompletion = {
  deploymentId: string
  status: 'succeeded' | 'failed' | 'canceled'
  gitSha: string | null
  logStartSeq?: number
  logs: Array<string>
  events: Array<DeploymentEvent>
}

export type AgentCleanupCompletion = {
  jobId: string
  status: 'succeeded' | 'failed' | 'canceled'
  message?: string | null
}

export type AgentBackupCompletion = {
  jobId: string
  backupRunId: string
  status: 'succeeded' | 'failed' | 'canceled'
  message?: string | null
  manifest?: unknown
  artifacts?: Array<{
    type: 'manifest' | 'volume' | 'database'
    storage: 'local' | 'remote'
    objectKey: string
    checksumSha256: string
    sizeBytes: number
  }>
}

export type AgentBackupCleanupCompletion = {
  jobId: string
  backupRunIds: Array<string>
  status: 'succeeded' | 'failed' | 'canceled'
  message?: string | null
}

export type AgentRestoreCompletion = {
  jobId: string
  status: 'succeeded' | 'failed' | 'canceled'
  message?: string | null
}

export type AgentJobProgress = {
  deploymentId: string
  logStartSeq: number
  logs: Array<string>
  events: Array<DeploymentEvent>
}

export type AgentJobStatus = {
  deploymentId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
}

export class AgentRequestError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = 'AgentRequestError'
  }
}

export async function handleAgentRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
  handler: (payload: T) => unknown | Promise<unknown>,
  failureMessage: string,
) {
  try {
    const body = await readRequestText(request, maxAgentRequestBytes)
    const payload = schema.parse(JSON.parse(body))
    return Response.json(await handler(payload))
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { error: 'Request payload is too large.' },
        { status: 413 },
      )
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: 'Invalid request payload.' },
        { status: 400 },
      )
    }

    if (error instanceof AgentRequestError) {
      return Response.json({ error: error.message }, { status: error.status })
    }

    console.error(failureMessage, error)
    return Response.json({ error: failureMessage }, { status: 500 })
  }
}
