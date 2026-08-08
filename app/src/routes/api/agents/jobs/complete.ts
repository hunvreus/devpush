import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import {
  completeBackupCleanupJob,
  completeBackupJob,
  completeCleanupJob,
  completeDeploymentJob,
  completeRestoreJob,
} from '@/server/agents/jobs'

const eventSchema = z.object({
  phase: z.enum([
    'agent_connected',
    'config_synced',
    'repo_fetched',
    'compose_resolved',
    'images_built_or_pulled',
    'release_command_started',
    'release_command_succeeded',
    'revision_started',
    'readiness_check_started',
    'traffic_switched',
    'old_revision_retired',
    'completed',
  ]),
  message: z.string().min(1),
})

const completeDeploymentJobSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  type: z.literal('deploy').optional(),
  deploymentId: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'canceled']),
  gitSha: z.string().min(1).nullable(),
  logStartSeq: z.number().int().positive().optional(),
  logs: z.array(z.string()),
  events: z.array(eventSchema),
})

const completeCleanupJobSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  type: z.enum(['deprovision', 'purge']),
  jobId: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'canceled']),
  message: z.string().optional().nullable(),
})

const backupArtifactSchema = z.object({
  type: z.enum(['manifest', 'volume', 'database']),
  storage: z.enum(['local', 'remote']).optional(),
  objectKey: z.string().trim().min(1).max(1_024),
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(0),
})

const completeBackupJobSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  type: z.literal('backup'),
  jobId: z.string().min(1),
  backupRunId: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'canceled']),
  message: z.string().optional().nullable(),
  manifest: z.unknown().optional(),
  artifacts: z.array(backupArtifactSchema).optional(),
})

const completeBackupCleanupJobSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  type: z.literal('backup_cleanup'),
  jobId: z.string().min(1),
  backupRunIds: z.array(z.string().min(1)).min(1),
  status: z.enum(['succeeded', 'failed', 'canceled']),
  message: z.string().optional().nullable(),
})

const completeRestoreJobSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  type: z.literal('restore'),
  jobId: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'canceled']),
  message: z.string().optional().nullable(),
})

const completeJobSchema = z.union([
  completeDeploymentJobSchema,
  completeCleanupJobSchema,
  completeBackupJobSchema,
  completeBackupCleanupJobSchema,
  completeRestoreJobSchema,
])

export const Route = createFileRoute('/api/agents/jobs/complete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = completeJobSchema.parse(await request.json())

          if (payload.type === 'backup') {
            const result = await completeBackupJob({
              serverId: payload.serverId,
              token: payload.token,
              completion: {
                jobId: payload.jobId,
                backupRunId: payload.backupRunId,
                status: payload.status,
                message: payload.message,
                manifest: payload.manifest,
                artifacts: payload.artifacts,
              },
            })

            return Response.json(result)
          }

          if (payload.type === 'backup_cleanup') {
            const result = await completeBackupCleanupJob({
              serverId: payload.serverId,
              token: payload.token,
              completion: {
                jobId: payload.jobId,
                backupRunIds: payload.backupRunIds,
                status: payload.status,
                message: payload.message,
              },
            })

            return Response.json(result)
          }

          if (payload.type === 'restore') {
            const result = await completeRestoreJob({
              serverId: payload.serverId,
              token: payload.token,
              completion: {
                jobId: payload.jobId,
                status: payload.status,
                message: payload.message,
              },
            })

            return Response.json(result)
          }

          if ('jobId' in payload) {
            const result = await completeCleanupJob({
              serverId: payload.serverId,
              token: payload.token,
              completion: {
                jobId: payload.jobId,
                status: payload.status,
                message: payload.message,
              },
            })

            return Response.json(result)
          }

          const result = await completeDeploymentJob({
            serverId: payload.serverId,
            token: payload.token,
            completion: {
              deploymentId: payload.deploymentId,
              status: payload.status,
              gitSha: payload.gitSha,
              logStartSeq: payload.logStartSeq,
              logs: payload.logs,
              events: payload.events,
            },
          })

          return Response.json(result)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to complete deployment job.',
            },
            { status: 401 },
          )
        }
      },
    },
  },
})
