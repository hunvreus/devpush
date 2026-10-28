import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runMaintenance } from './maintenance'

vi.mock('#devpush/server/notifications/outbox', () => ({
  pruneOperationalNotifications: vi.fn().mockResolvedValue(undefined),
}))

const mocks = vi.hoisted(() => ({
  maintainDeployment: vi.fn(),
  pruneApiHistory: vi.fn(),
  pruneDeletedResources: vi.fn(),
  cleanupExpiredRateLimits: vi.fn(),
  cleanupExpiredTeamInvites: vi.fn(),
  failStaleRunningDeployments: vi.fn(),
  failStaleQueuedDeployments: vi.fn(),
  failStaleAgentJobs: vi.fn(),
  queueBackupRetentionCleanupJobs: vi.fn(),
  runQueuedUserCleanupJobs: vi.fn(),
  pruneServerMonitoring: vi.fn(),
  pruneExpiredRuntimeLogs: vi.fn(),
  pruneOrphanDeploymentLogs: vi.fn(),
}))

vi.mock('#devpush/server/plugins/services.server', () => ({
  getPluginServices: () => ({
    serverLifecycle: { maintain: mocks.maintainDeployment },
  }),
}))

vi.mock('#devpush/server/deleted-resources', () => ({
  pruneDeletedResources: mocks.pruneDeletedResources,
}))

vi.mock('#devpush/server/api/retention', () => ({
  pruneApiHistory: mocks.pruneApiHistory,
}))
vi.mock('#devpush/server/agents/jobs', () => ({
  failStaleRunningDeployments: mocks.failStaleRunningDeployments,
  failStaleQueuedDeployments: mocks.failStaleQueuedDeployments,
  failStaleAgentJobs: mocks.failStaleAgentJobs,
}))
vi.mock('#devpush/server/backups/service', () => ({
  queueBackupRetentionCleanupJobs: mocks.queueBackupRetentionCleanupJobs,
}))
vi.mock('#devpush/server/http/rate-limit', () => ({
  cleanupExpiredRateLimits: mocks.cleanupExpiredRateLimits,
}))
vi.mock('#devpush/server/teams/service', () => ({
  cleanupExpiredTeamInvites: mocks.cleanupExpiredTeamInvites,
}))
vi.mock('#devpush/server/users/service', () => ({
  runQueuedUserCleanupJobs: mocks.runQueuedUserCleanupJobs,
}))
vi.mock('#devpush/server/servers/monitoring', () => ({
  pruneServerMonitoring: mocks.pruneServerMonitoring,
}))
vi.mock('#devpush/server/logs/retention', () => ({
  pruneExpiredRuntimeLogs: mocks.pruneExpiredRuntimeLogs,
}))
vi.mock('#devpush/server/logs/cleanup', () => ({
  pruneOrphanDeploymentLogs: mocks.pruneOrphanDeploymentLogs,
}))

describe('runMaintenance', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
    mocks.failStaleQueuedDeployments.mockResolvedValue([])
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

  test('plugin maintenance failure retains cleanup source records', async () => {
    mocks.maintainDeployment.mockRejectedValue(new Error('provider offline'))
    await expect(runMaintenance()).rejects.toThrow('provider offline')
    expect(mocks.pruneDeletedResources).not.toHaveBeenCalled()
  })

  test('runs every periodic cleanup task', async () => {
    await expect(runMaintenance()).resolves.toEqual({
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
