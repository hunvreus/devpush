import { describe, expect, test } from 'vitest'

import { assertRuntimeSecurity, parseConfig } from './config'

describe('server config', () => {
  test('defaults monitoring retention to seven days and validates overrides', () => {
    expect(parseConfig({}).DEVPUSH_MONITORING_RETENTION_DAYS).toBe(7)
    expect(
      parseConfig({ DEVPUSH_MONITORING_RETENTION_DAYS: '30' })
        .DEVPUSH_MONITORING_RETENTION_DAYS,
    ).toBe(30)
    for (const days of ['0', '1', '1.5', '-1', 'invalid', '3651']) {
      expect(() =>
        parseConfig({ DEVPUSH_MONITORING_RETENTION_DAYS: days }),
      ).toThrow()
    }
  })
  test('uses the local origin for both base URLs by default', () => {
    const config = parseConfig({})

    expect(config.DEVPUSH_BASE_URL).toBe('http://localhost:7429')
    expect(config.BETTER_AUTH_URL).toBe('http://localhost:7429')
    expect(config.DEVPUSH_TRUST_PROXY).toBe(false)
  })

  test('defaults Better Auth to the devpush base URL', () => {
    const config = parseConfig({
      DEVPUSH_BASE_URL: 'https://devpush.example',
    })

    expect(config.DEVPUSH_BASE_URL).toBe('https://devpush.example')
    expect(config.BETTER_AUTH_URL).toBe('https://devpush.example')
  })

  test('allows an auth-specific URL override', () => {
    const config = parseConfig({
      BETTER_AUTH_URL: 'http://localhost:7429',
      DEVPUSH_BASE_URL: 'http://host.lima.internal:7429',
    })

    expect(config.DEVPUSH_BASE_URL).toBe('http://host.lima.internal:7429')
    expect(config.BETTER_AUTH_URL).toBe('http://localhost:7429')
  })

  test('rejects default secrets for a public deployment', () => {
    const config = parseConfig({ DEVPUSH_BASE_URL: 'https://devpush.example' })

    expect(() => assertRuntimeSecurity(config)).toThrow('BETTER_AUTH_SECRET')
  })

  test('requires separate strong secrets for a public deployment', () => {
    const config = parseConfig({
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      DEVPUSH_BASE_URL: 'https://devpush.example',
      DEVPUSH_SECRET_ENCRYPTION_KEY: 'b'.repeat(32),
    })

    expect(() => assertRuntimeSecurity(config)).not.toThrow()
  })

  test('rejects production example placeholders', () => {
    const config = parseConfig({
      BETTER_AUTH_SECRET: 'replace-with-a-long-random-secret',
      DEVPUSH_BASE_URL: 'https://devpush.example',
      DEVPUSH_SECRET_ENCRYPTION_KEY:
        'replace-with-a-separate-long-random-secret',
    })

    expect(() => assertRuntimeSecurity(config)).toThrow('BETTER_AUTH_SECRET')

    config.BETTER_AUTH_SECRET = 'a'.repeat(32)
    expect(() => assertRuntimeSecurity(config)).toThrow(
      'DEVPUSH_SECRET_ENCRYPTION_KEY',
    )

    config.DEVPUSH_SECRET_ENCRYPTION_KEY = 'b'.repeat(32)
    config.DEVPUSH_CRON_SECRET = 'replace-with-a-long-random-secret'
    expect(() => assertRuntimeSecurity(config)).toThrow('DEVPUSH_CRON_SECRET')
  })
})
