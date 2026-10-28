import { pruneOperationalNotifications } from '#devpush/server/notifications/outbox'
import { getPluginServices } from '#devpush/server/plugins/services.server'
import { pruneDeletedResources } from '#devpush/server/deleted-resources'
import { pruneApiHistory } from '#devpush/server/api/retention'
import {
  failStaleRunningDeployments,
  failStaleQueuedDeployments,
  failStaleAgentJobs,
} from '#devpush/server/agents/jobs'
import { queueBackupRetentionCleanupJobs } from '#devpush/server/backups/service'
import { cleanupExpiredRateLimits } from '#devpush/server/http/rate-limit'
import { cleanupExpiredTeamInvites } from '#devpush/server/teams/service'
import { runQueuedUserCleanupJobs } from '#devpush/server/users/service'
import { pruneServerMonitoring } from '#devpush/server/servers/monitoring'
import { pruneExpiredRuntimeLogs } from '#devpush/server/logs/retention'
import { pruneOrphanDeploymentLogs } from '#devpush/server/logs/cleanup'

export async function runMaintenance() {
  const [
    expiredInvites,
    staleDeployments,
    staleQueuedDeployments,
    staleAgentJobs,
    userCleanupJobs,
    backupCleanupJobs,
    ,
    monitoring,
    runtimeLogs,
    deploymentLogs,
    apiHistory,
  ] = await Promise.all([
    cleanupExpiredTeamInvites(),
    failStaleRunningDeployments(),
    failStaleQueuedDeployments(),
    failStaleAgentJobs(),
    runQueuedUserCleanupJobs(),
    queueBackupRetentionCleanupJobs(),
    cleanupExpiredRateLimits(),
    pruneServerMonitoring(),
    pruneExpiredRuntimeLogs(),
    pruneOrphanDeploymentLogs(),
    pruneApiHistory(),
    pruneOperationalNotifications(),
  ])

  await getPluginServices().serverLifecycle?.maintain()
  const deletedResources = await pruneDeletedResources()

  return {
    deletedResources,
    expiredInvites: expiredInvites.expiredCount,
    staleDeployments: staleDeployments.length + staleQueuedDeployments.length,
    staleAgentJobs: staleAgentJobs.length,
    userCleanupJobs,
    backupCleanupJobs: backupCleanupJobs.length,
    monitoring,
    runtimeLogs,
    deploymentLogs,
    apiHistory,
  }
}
