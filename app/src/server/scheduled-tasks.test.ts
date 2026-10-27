import { expect, test, vi, beforeEach } from 'vitest'
import { runScheduledTasks } from './scheduled-tasks'

vi.mock('#devpush/server/notifications/observe', () => ({
  maintainOperationalNotifications: vi.fn().mockResolvedValue(undefined),
}))
const mocks = vi.hoisted(() => ({
  backups: vi.fn(),
  maintenance: vi.fn(),
  config: { DEVPUSH_BACKUPS_ENABLED: true },
}))
vi.mock('#devpush/server/config', () => ({ config: mocks.config }))
vi.mock('#devpush/server/backups/service', () => ({
  queueDueBackupSchedules: mocks.backups,
}))
vi.mock('#devpush/server/maintenance', () => ({
  runMaintenance: mocks.maintenance,
}))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.config.DEVPUSH_BACKUPS_ENABLED = true
})
test('minute ticks queue backups and hourly ticks also run maintenance', async () => {
  await runScheduledTasks(false)
  expect(mocks.backups).toHaveBeenCalledTimes(1)
  expect(mocks.maintenance).not.toHaveBeenCalled()
  await runScheduledTasks(true)
  expect(mocks.maintenance).toHaveBeenCalledTimes(1)
})
test('maintenance runs with backups disabled', async () => {
  mocks.config.DEVPUSH_BACKUPS_ENABLED = false
  await runScheduledTasks(true)
  expect(mocks.backups).not.toHaveBeenCalled()
  expect(mocks.maintenance).toHaveBeenCalledOnce()
})
test('backup failures do not prevent maintenance and errors propagate for retry', async () => {
  mocks.backups.mockRejectedValue(new Error('backup failure'))
  await expect(runScheduledTasks(true)).rejects.toThrow(
    'Scheduled tasks failed',
  )
  expect(mocks.maintenance).toHaveBeenCalledOnce()
})
