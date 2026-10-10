import { expect, test } from 'vitest'
import { backupScheduleSchema } from './backup-policy-schema'

test.each(['61 * * * *', '0 24 * * *', '*/0 * * * *', 'a b c d e'])(
  'rejects invalid schedule %s',
  (cron) => {
    expect(backupScheduleSchema.safeParse({ cron }).success).toBe(false)
  },
)
test('accepts scheduler-supported ranges, steps and lists', () => {
  expect(
    backupScheduleSchema.safeParse({ cron: '*/15 1-5 * * 1,3,5' }).success,
  ).toBe(true)
})
