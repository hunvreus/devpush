import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runMaintenance } from './maintenance'

const mocks = vi.hoisted(() => ({
  cleanupExpiredRateLimits: vi.fn(),
  cleanupExpiredTeamInvites: vi.fn(),
  failStaleRunningDeployments: vi.fn(),
  queueBackupRetentionCleanupJobs: vi.fn(),
  runQueuedUserCleanupJobs: vi.fn(),
  pruneServerMonitoring: vi.fn(),
  pruneExpiredRuntimeLogs: vi.fn(),
  pruneOrphanDeploymentLogs: vi.fn(),
}))

vi.mock('@/server/agents/jobs', () => ({
  failStaleRunningDeployments: mocks.failStaleRunningDeployments,
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
    vi.clearAllMocks()
    mocks.cleanupExpiredRateLimits.mockResolvedValue(undefined)
    mocks.cleanupExpiredTeamInvites.mockResolvedValue({ expiredCount: 2 })
    mocks.failStaleRunningDeployments.mockResolvedValue(['first'])
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
      expiredInvites: 2,
      staleDeployments: 1,
      userCleanupJobs: ['second'],
      backupCleanupJobs: 1,
      monitoring: { heartbeats: 3, metrics: 4 },
      runtimeLogs: { deleted: 5 },
      deploymentLogs: { checked: 2, deleted: 6 },
    })

    expect(mocks.cleanupExpiredRateLimits).toHaveBeenCalledOnce()
    expect(mocks.cleanupExpiredTeamInvites).toHaveBeenCalledOnce()
    expect(mocks.failStaleRunningDeployments).toHaveBeenCalledOnce()
    expect(mocks.queueBackupRetentionCleanupJobs).toHaveBeenCalledOnce()
    expect(mocks.runQueuedUserCleanupJobs).toHaveBeenCalledOnce()
    expect(mocks.pruneServerMonitoring).toHaveBeenCalledOnce()
    expect(mocks.pruneExpiredRuntimeLogs).toHaveBeenCalledOnce()
    expect(mocks.pruneOrphanDeploymentLogs).toHaveBeenCalledOnce()
  })
})
