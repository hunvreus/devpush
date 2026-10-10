import { describe, expect, test } from 'vitest'

import { isCronDue, isValidCron } from './cron'

describe('backup cron schedules', () => {
  test('incomplete schedules are not due', () => {
    expect(isCronDue('* * *', new Date())).toBe(false)
  })
  test('validates ranges, lists, and steps', () => {
    expect(isValidCron('*/15 1-5 * * 1,3,5')).toBe(true)
    expect(isValidCron('61 * * * *')).toBe(false)
    expect(isValidCron('*/0 * * * *')).toBe(false)
    expect(isValidCron('* * *')).toBe(false)
  })

  test('applies steps from the field minimum', () => {
    expect(isCronDue('0 0 */2 * *', new Date('2030-01-03T00:00:00Z'))).toBe(
      true,
    )
    expect(isCronDue('0 0 */2 * *', new Date('2030-01-02T00:00:00Z'))).toBe(
      false,
    )
  })

  test('uses standard OR semantics for day-of-month and day-of-week', () => {
    expect(isCronDue('0 0 10 * 1', new Date('2030-07-08T00:00:00Z'))).toBe(true)
    expect(isCronDue('0 0 10 * 1', new Date('2030-07-10T00:00:00Z'))).toBe(true)
  })
})
