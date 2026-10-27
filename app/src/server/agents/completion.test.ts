import { afterEach, expect, test, vi } from 'vitest'
import { completeAgentJob } from './completion'
import { completeAgentJobSchema } from './protocol'

vi.mock('#devpush/server/notifications/observe', () => ({
  notifyAfterAgentCompletion: vi.fn().mockResolvedValue(undefined),
}))

const handlers = vi.hoisted(() => ({
  deploy: vi.fn(),
  cleanup: vi.fn(),
  backup: vi.fn(),
  backupCleanup: vi.fn(),
  restore: vi.fn(),
}))
vi.mock('./jobs', () => ({
  completeDeploymentJob: handlers.deploy,
  completeCleanupJob: handlers.cleanup,
  completeBackupJob: handlers.backup,
  completeBackupCleanupJob: handlers.backupCleanup,
  completeRestoreJob: handlers.restore,
}))
afterEach(() => vi.resetAllMocks())

test.each([
  [
    'deploy',
    'deploy',
    {
      deploymentId: 'deployment',
      gitSha: null,
      logStartSeq: 1,
      logs: [],
      events: [],
    },
  ],
  ['deprovision', 'cleanup', { jobId: 'job', attempt: 2, message: 'removed' }],
  ['purge', 'cleanup', { jobId: 'job', attempt: 2, message: 'removed' }],
  [
    'backup',
    'backup',
    { jobId: 'job', backupRunId: 'run', message: 'saved', artifacts: [] },
  ],
  [
    'backup_cleanup',
    'backupCleanup',
    { jobId: 'job', backupRunIds: ['run'], message: 'cleaned' },
  ],
  ['restore', 'restore', { jobId: 'job', message: 'restored' }],
] as const)(
  'routes %s completion to its domain handler',
  async (type, expected, details) => {
    const payload = completeAgentJobSchema.parse({
      type,
      serverId: 'server',
      token: 'fixture-token',
      status: 'succeeded',
      ...details,
    })
    handlers[expected].mockResolvedValueOnce({ accepted: true })
    expect(await completeAgentJob(payload)).toEqual({ accepted: true })
    expect(handlers[expected]).toHaveBeenCalledWith({
      serverId: 'server',
      token: 'fixture-token',
      completion: expect.objectContaining({ status: 'succeeded', ...details }),
    })
    for (const [name, handler] of Object.entries(handlers)) {
      expect(handler).toHaveBeenCalledTimes(name === expected ? 1 : 0)
    }
  },
)

test.each([undefined, 0, -1, 1.5])(
  'cleanup rejects invalid or missing attempt %s',
  (attempt) => {
    expect(
      completeAgentJobSchema.safeParse({
        type: 'purge',
        serverId: 'server',
        token: 'token',
        jobId: 'job',
        status: 'succeeded',
        attempt,
      }).success,
    ).toBe(false)
  },
)
