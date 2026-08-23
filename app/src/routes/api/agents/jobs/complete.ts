import { createFileRoute } from '@tanstack/react-router'

import {
  completeBackupCleanupJob,
  completeBackupJob,
  completeCleanupJob,
  completeDeploymentJob,
  completeRestoreJob,
} from '@/server/agents/jobs'
import {
  completeAgentJobSchema,
  handleAgentRequest,
} from '@/server/agents/protocol'

export const Route = createFileRoute('/api/agents/jobs/complete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleAgentRequest(
          request,
          completeAgentJobSchema,
          async (payload) => {
            if (payload.type === 'backup') {
              return completeBackupJob({
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
            }

            if (payload.type === 'backup_cleanup') {
              return completeBackupCleanupJob({
                serverId: payload.serverId,
                token: payload.token,
                completion: {
                  jobId: payload.jobId,
                  backupRunIds: payload.backupRunIds,
                  status: payload.status,
                  message: payload.message,
                },
              })
            }

            if (payload.type === 'restore') {
              return completeRestoreJob({
                serverId: payload.serverId,
                token: payload.token,
                completion: {
                  jobId: payload.jobId,
                  status: payload.status,
                  message: payload.message,
                },
              })
            }

            if ('jobId' in payload) {
              return completeCleanupJob({
                serverId: payload.serverId,
                token: payload.token,
                completion: {
                  jobId: payload.jobId,
                  status: payload.status,
                  message: payload.message,
                },
              })
            }

            return completeDeploymentJob({
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
          },
          'Unable to complete agent job.',
        )
      },
    },
  },
})
