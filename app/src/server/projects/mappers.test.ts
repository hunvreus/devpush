import { expect, test, vi } from 'vitest'
import { PublicError } from '#devpush/lib/public-error'
import { parseBackupSchedule } from './mappers'

vi.mock('#devpush/server/config', () => ({ config: {} }))

test.each(['61 * * * *', '* 24 * * *', '* * * 13 *', '*/0 * * * *'])(
  'stored backup schedule rejects an impossible cron expression: %s',
  (cron) => {
    expect(() => parseBackupSchedule({ cron })).toThrow(
      new PublicError('BACKUP_SCHEDULE_INVALID'),
    )
  },
)

test('stored backup schedules use the same supported cron grammar as editors', () => {
  expect(parseBackupSchedule({ cron: '  */15 1-5 * * 1,3,5  ' })).toEqual({
    cron: '*/15 1-5 * * 1,3,5',
  })
})
