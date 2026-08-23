import { describe, expect, test } from 'vitest'

import {
  formatBytes,
  getDefaultRestoreCommand,
  getSinceDate,
  isCronSchedule,
  isUrl,
} from './project-backup-utils'

describe('project backup helpers', () => {
  test('computes relative backup filter windows deterministically', () => {
    const now = new Date('2026-08-22T12:00:00.000Z')
    expect(getSinceDate('7d', now)?.toISOString()).toBe(
      '2026-08-15T12:00:00.000Z',
    )
    expect(getSinceDate(undefined, now)).toBeNull()
  })

  test('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  test('provides known database restore commands', () => {
    expect(getDefaultRestoreCommand('postgres')).toContain('psql')
    expect(getDefaultRestoreCommand('worker')).toBe('')
  })

  test('validates cron and URL input', () => {
    expect(isCronSchedule('0 2 * * *')).toBe(true)
    expect(isCronSchedule('daily')).toBe(false)
    expect(isUrl('https://s3.example.com')).toBe(true)
    expect(isUrl('not a url')).toBe(false)
  })
})
