import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runMaintenance } from './maintenance'

const mocks = vi.hoisted(() => ({
  maintainDeployment: vi.fn(),
  pruneApiHistory: vi.fn(),
  pruneDeletedResources: vi.fn(),
  encryptExistingProviderTokens: vi.fn(),
  cleanupExpiredRateLimits: vi.fn(),
  cleanupExpiredTeamInvites: vi.fn(),
  failStaleRunningDeployments: vi.fn(),
  failStaleAgentJobs: vi.fn(),
  queueBackupRetentionCleanupJobs: vi.fn(),
  runQueuedUserCleanupJobs: vi.fn(),
  pruneServerMonitoring: vi.fn(),
  pruneExpiredRuntimeLogs: vi.fn(),
  pruneOrphanDeploymentLogs: vi.fn(),
}))

vi.mock('@/deployment/services.server', () => ({
  getDeploymentServices: () => ({
    serverLifecycle: { maintain: mocks.maintainDeployment },
  }),
}))

vi.mock('@/server/auth/provider-tokens', () => ({
  encryptExistingProviderTokens: mocks.encryptExistingProviderTokens,
}))

vi.mock('@/server/deleted-resources', () => ({
  pruneDeletedResources: mocks.pruneDeletedResources,
}))

vi.mock('@/server/api/retention', () => ({
  pruneApiHistory: mocks.pruneApiHistory,
}))
vi.mock('@/server/agents/jobs', () => ({
  failStaleRunningDeployments: mocks.failStaleRunningDeployments,
  failStaleAgentJobs: mocks.failStaleAgentJobs,
}))
vi.mock('@/server/backups/service', () => ({
  queueBackupRetentionCleanupJobs: mocks.queueBackupRetentionCleanupJobs,
}))
vi.mock('@/server/http/rate-limit', () => ({
  cleanupExpiredRateLimits: mocks.cleanupExpiredRateLimits,
}))
vi.mock('@/server/teams/service', () => ({
  cleanupExpiredTeamInvites: mocks.cleanupExpiredTeamInvites,
}))
vi.mock('@/server/users/service', () => ({
  runQueuedUserCleanupJobs: mocks.runQueuedUserCleanupJobs,
}))
vi.mock('@/server/servers/monitoring', () => ({
  pruneServerMonitoring: mocks.pruneServerMonitoring,
}))
vi.mock('@/server/logs/retention', () => ({
  pruneExpiredRuntimeLogs: mocks.pruneExpiredRuntimeLogs,
}))
vi.mock('@/server/logs/cleanup', () => ({
  pruneOrphanDeploymentLogs: mocks.pruneOrphanDeploymentLogs,
}))

describe('runMaintenance', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.encryptExistingProviderTokens.mockResolvedValue({
      checked: 2,
      encrypted: 2,
    })
    mocks.pruneDeletedResources.mockResolvedValue({
      projects: 1,
      servers: 2,
      teams: 3,
      users: 4,
    })
    mocks.pruneApiHistory.mockResolvedValue({
      idempotency: 1,
      audit: 2,
      accessTokens: 3,
      refreshTokens: 4,
    })
    mocks.cleanupExpiredRateLimits.mockResolvedValue(undefined)
    mocks.cleanupExpiredTeamInvites.mockResolvedValue({ expiredCount: 2 })
    mocks.failStaleRunningDeployments.mockResolvedValue(['first'])
    mocks.failStaleAgentJobs.mockResolvedValue(['backup'])
    mocks.queueBackupRetentionCleanupJobs.mockResolvedValue([
      { id: 'cleanup', backupRunIds: ['run'] },
    ])
    mocks.runQueuedUserCleanupJobs.mockResolvedValue(['second'])
    mocks.pruneServerMonitoring.mockResolvedValue({ heartbeats: 3, metrics: 4 })
    mocks.pruneExpiredRuntimeLogs.mockResolvedValue({ deleted: 5 })
    mocks.pruneOrphanDeploymentLogs.mockResolvedValue({
      checked: 2,
      deleted: 6,
    })
  })

  test('runs every periodic cleanup task', async () => {
    await expect(runMaintenance()).resolves.toEqual({
      providerTokens: { checked: 2, encrypted: 2 },
      deletedResources: { projects: 1, servers: 2, teams: 3, users: 4 },
      apiHistory: {
        idempotency: 1,
        audit: 2,
        accessTokens: 3,
        refreshTokens: 4,
      },
      expiredInvites: 2,
      staleDeployments: 1,
      staleAgentJobs: 1,
      userCleanupJobs: ['second'],
      backupCleanupJobs: 1,
      monitoring: { heartbeats: 3, metrics: 4 },
      runtimeLogs: { deleted: 5 },
      deploymentLogs: { checked: 2, deleted: 6 },
    })

    expect(mocks.pruneApiHistory).toHaveBeenCalledOnce()
    expect(mocks.cleanupExpiredRateLimits).toHaveBeenCalledOnce()
    expect(mocks.cleanupExpiredTeamInvites).toHaveBeenCalledOnce()
    expect(mocks.failStaleRunningDeployments).toHaveBeenCalledOnce()
    expect(mocks.failStaleAgentJobs).toHaveBeenCalledOnce()
    expect(mocks.queueBackupRetentionCleanupJobs).toHaveBeenCalledOnce()
    expect(mocks.runQueuedUserCleanupJobs).toHaveBeenCalledOnce()
    expect(mocks.pruneServerMonitoring).toHaveBeenCalledOnce()
    expect(mocks.pruneExpiredRuntimeLogs).toHaveBeenCalledOnce()
    expect(mocks.pruneOrphanDeploymentLogs).toHaveBeenCalledOnce()
  })
  test('reconciles deployment resources before permanently pruning servers', async () => {
    await runMaintenance()
    expect(mocks.maintainDeployment).toHaveBeenCalledOnce()
    expect(mocks.maintainDeployment.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pruneDeletedResources.mock.invocationCallOrder[0]!,
    )
  })

  test('retains server records when deployment reconciliation fails', async () => {
    mocks.maintainDeployment.mockRejectedValue(
      new Error('provider unavailable'),
    )
    await expect(runMaintenance()).rejects.toThrow('provider unavailable')
    expect(mocks.pruneDeletedResources).not.toHaveBeenCalled()
  })
})
