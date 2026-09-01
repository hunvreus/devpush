import { describe, expect, test } from 'vitest'

import { isValidAllowlistPattern, normalizeEmail } from './access'

describe('authentication access helpers', () => {
  test('normalizes email addresses at the boundary', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com')
  })

  test('accepts ordinary allowlist patterns', () => {
    expect(isValidAllowlistPattern('[^@]+@example\\.com')).toBe(true)
  })

  test('rejects unsafe or oversized allowlist patterns', () => {
    expect(isValidAllowlistPattern('(a+)+$')).toBe(false)
    expect(isValidAllowlistPattern('a'.repeat(256))).toBe(false)
  })
})
