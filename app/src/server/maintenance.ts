import { getDeploymentServices } from '@/deployment/services.server'
import { encryptExistingProviderTokens } from '@/server/auth/provider-tokens'
import { pruneDeletedResources } from '@/server/deleted-resources'
import { pruneApiHistory } from '@/server/api/retention'
import {
  failStaleRunningDeployments,
  failStaleAgentJobs,
} from '@/server/agents/jobs'
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
  ])

  await getDeploymentServices().serverLifecycle?.maintain()
  const deletedResources = await pruneDeletedResources()
  const providerTokens = await encryptExistingProviderTokens()

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
