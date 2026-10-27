import { pruneOperationalNotifications } from '#devpush/server/notifications/outbox'
import { getPluginServices } from '#devpush/server/plugins/services.server'
import { encryptExistingProviderTokens } from '#devpush/server/auth/provider-tokens'
import { pruneDeletedResources } from '#devpush/server/deleted-resources'
import { pruneApiHistory } from '#devpush/server/api/retention'
import {
  failStaleRunningDeployments,
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

  let providerTokens
  try {
    await getPluginServices().serverLifecycle?.maintain()
  } finally {
    // Token rewrites are independent, but resource deletion must still wait for
    // provider cleanup to succeed so reconciliation retains its source records.
    providerTokens = await encryptExistingProviderTokens()
  }
  const deletedResources = await pruneDeletedResources()

  return {
    deletedResources,
    providerTokens,
    expiredInvites: expiredInvites.expiredCount,
    staleDeployments: staleDeployments.length,
    staleAgentJobs: staleAgentJobs.length,
    userCleanupJobs,
    backupCleanupJobs: backupCleanupJobs.length,
    monitoring,
    runtimeLogs,
    deploymentLogs,
    apiHistory,
  }
}
