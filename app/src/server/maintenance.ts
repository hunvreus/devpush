import { failStaleRunningDeployments } from '@/server/agents/jobs'
import { queueBackupRetentionCleanupJobs } from '@/server/backups/service'
import { cleanupExpiredRateLimits } from '@/server/http/rate-limit'
import { cleanupExpiredTeamInvites } from '@/server/teams/service'
import { runQueuedUserCleanupJobs } from '@/server/users/service'
import { pruneServerMonitoring } from '@/server/servers/monitoring'
import { pruneExpiredRuntimeLogs } from '@/server/logs/retention'
import { pruneOrphanDeploymentLogs } from '@/server/logs/cleanup'

export async function runMaintenance() {
  const [
    expiredInvites,
    staleDeployments,
    userCleanupJobs,
    backupCleanupJobs,
    ,
    monitoring,
    runtimeLogs,
    deploymentLogs,
  ] = await Promise.all([
    cleanupExpiredTeamInvites(),
    failStaleRunningDeployments(),
    runQueuedUserCleanupJobs(),
    queueBackupRetentionCleanupJobs(),
    cleanupExpiredRateLimits(),
    pruneServerMonitoring(),
    pruneExpiredRuntimeLogs(),
    pruneOrphanDeploymentLogs(),
  ])

  return {
    expiredInvites: expiredInvites.expiredCount,
    staleDeployments: staleDeployments.length,
    userCleanupJobs,
    backupCleanupJobs: backupCleanupJobs.length,
    monitoring,
    runtimeLogs,
    deploymentLogs,
  }
}
