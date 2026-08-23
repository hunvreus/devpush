import { describe, expect, test } from 'vitest'

import { auth } from './index'

describe('auth cookies', () => {
  test('uses an application-specific cookie namespace', () => {
    expect(auth.options.advanced.cookiePrefix).toBe('devpush')
  })
})
