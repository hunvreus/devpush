import { notifyAfterAgentCompletion } from '#devpush/server/notifications/observe'
import {
  completeBackupCleanupJob,
  completeBackupJob,
  completeCleanupJob,
  completeDeploymentJob,
  completeRestoreJob,
} from '#devpush/server/agents/jobs'
import type { CompleteAgentJobPayload } from './protocol'

export async function completeAgentJob(payload: CompleteAgentJobPayload) {
  const result = await completeJob(payload)
  await notifyAfterAgentCompletion(payload.serverId)
  return result
}

async function completeJob(payload: CompleteAgentJobPayload) {
  if (payload.type === 'deploy') {
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
  }

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

  return completeCleanupJob({
    serverId: payload.serverId,
    token: payload.token,
    completion: {
      jobId: payload.jobId,
      attempt: payload.attempt,
      status: payload.status,
      message: payload.message,
    },
  })
}
