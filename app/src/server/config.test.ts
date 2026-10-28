import { describe, expect, test } from 'vitest'

import { assertRuntimeSecurity, parseConfig } from './config'

describe('server config', () => {
  test('validates deployment queue TTL', () => {
    expect(parseConfig({}).DEVPUSH_DEPLOYMENT_QUEUE_TTL_HOURS).toBe(24)
    expect(
      parseConfig({ DEVPUSH_DEPLOYMENT_QUEUE_TTL_HOURS: '48' })
        .DEVPUSH_DEPLOYMENT_QUEUE_TTL_HOURS,
    ).toBe(48)
    for (const value of ['0', '721', '1.5', 'invalid'])
      expect(() =>
        parseConfig({ DEVPUSH_DEPLOYMENT_QUEUE_TTL_HOURS: value }),
      ).toThrow()
  })
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
    expect(config.DEVPUSH_MCP_URL).toBe('http://localhost:7429/mcp')
    expect(config.DEVPUSH_TRUST_PROXY).toBe(false)
    expect(config.DEVPUSH_CLIENT_IP_HEADER).toBe('x-forwarded-for')
  })

  test('proxy address header is explicit and limited to supported headers', () => {
    expect(
      parseConfig({ DEVPUSH_CLIENT_IP_HEADER: 'x-real-ip' })
        .DEVPUSH_CLIENT_IP_HEADER,
    ).toBe('x-real-ip')
    expect(() =>
      parseConfig({ DEVPUSH_CLIENT_IP_HEADER: 'authorization' }),
    ).toThrow()
  })

  test('defaults Better Auth to the devpush base URL', () => {
    const config = parseConfig({
      DEVPUSH_BASE_URL: 'https://devpush.example',
    })

    expect(config.DEVPUSH_BASE_URL).toBe('https://devpush.example')
    expect(config.BETTER_AUTH_URL).toBe('https://devpush.example')
    expect(config.DEVPUSH_MCP_URL).toBe('https://devpush.example/mcp')
  })

  test('allows an auth-specific URL override', () => {
    const config = parseConfig({
      BETTER_AUTH_URL: 'http://localhost:7429',
      DEVPUSH_BASE_URL: 'http://host.lima.internal:7429',
    })

    expect(config.DEVPUSH_BASE_URL).toBe('http://host.lima.internal:7429')
    expect(config.BETTER_AUTH_URL).toBe('http://localhost:7429')
    expect(config.DEVPUSH_MCP_URL).toBe('http://host.lima.internal:7429/mcp')
  })

  test('allows a browser-reachable MCP endpoint independently of Lima and authentication origins', () => {
    const config = parseConfig({
      DEVPUSH_BASE_URL: 'http://host.lima.internal:7429',
      BETTER_AUTH_URL: 'http://localhost:7429',
      DEVPUSH_MCP_URL: 'http://localhost:7429/mcp',
    })
    expect(config.DEVPUSH_BASE_URL).toBe('http://host.lima.internal:7429')
    expect(config.BETTER_AUTH_URL).toBe('http://localhost:7429')
    expect(config.DEVPUSH_MCP_URL).toBe('http://localhost:7429/mcp')
  })

  test.each([
    'https://user:secret@devpush.example/mcp',
    'https://devpush.example/mcp?token=secret',
    'https://devpush.example/mcp?',
    'https://devpush.example/mcp#fragment',
    'https://devpush.example/mcp#',
    'https://devpush.example/',
    'https://devpush.example/mcp/',
    'https://devpush.example/other',
    'ftp://devpush.example/mcp',
    'http://devpush.example/mcp',
    'http://192.168.1.1/mcp',
  ])('rejects unsafe or noncanonical MCP URL %s', (DEVPUSH_MCP_URL) => {
    expect(() => parseConfig({ DEVPUSH_MCP_URL })).toThrow()
  })

  test.each([
    'http://localhost:7429/mcp',
    'http://127.0.0.1:7429/mcp',
    'http://[::1]:7429/mcp',
    'http://host.lima.internal:7429/mcp',
    'https://mcp.devpush.example/mcp',
  ])('accepts a safe canonical MCP URL %s', (DEVPUSH_MCP_URL) => {
    expect(parseConfig({ DEVPUSH_MCP_URL }).DEVPUSH_MCP_URL).toBe(
      DEVPUSH_MCP_URL,
    )
  })

  test('rejects default secrets for a public deployment', () => {
    const config = parseConfig({ DEVPUSH_BASE_URL: 'https://devpush.example' })

    expect(() => assertRuntimeSecurity(config)).toThrow('BETTER_AUTH_SECRET')
  })

  test('public MCP with a local agent base still requires production secrets', () => {
    const config = parseConfig({
      DEVPUSH_BASE_URL: 'http://host.lima.internal:7429',
      BETTER_AUTH_URL: 'http://localhost:7429',
      DEVPUSH_MCP_URL: 'https://mcp.devpush.example/mcp',
    })
    expect(() => assertRuntimeSecurity(config)).toThrow('BETTER_AUTH_SECRET')
    config.BETTER_AUTH_SECRET = 'a'.repeat(32)
    expect(() => assertRuntimeSecurity(config)).toThrow(
      'DEVPUSH_SECRET_ENCRYPTION_KEY',
    )
    config.DEVPUSH_SECRET_ENCRYPTION_KEY = 'b'.repeat(32)
    expect(() => assertRuntimeSecurity(config)).not.toThrow()
  })

  test('public authentication with local MCP also requires production secrets', () => {
    const config = parseConfig({
      DEVPUSH_BASE_URL: 'http://localhost:7429',
      BETTER_AUTH_URL: 'https://auth.devpush.example',
      DEVPUSH_MCP_URL: 'http://localhost:7429/mcp',
    })
    expect(() => assertRuntimeSecurity(config)).toThrow('BETTER_AUTH_SECRET')
  })

  test.each(['http://host.lima.internal:7429', 'http://[::1]:7429'])(
    'retains local development security behavior for %s',
    (DEVPUSH_BASE_URL) => {
      const config = parseConfig({
        DEVPUSH_BASE_URL,
        BETTER_AUTH_URL: 'http://localhost:7429',
        DEVPUSH_MCP_URL: 'http://localhost:7429/mcp',
      })
      expect(() => assertRuntimeSecurity(config)).not.toThrow()
    },
  )

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

test.each(['DEVPUSH_BASE_URL', 'BETTER_AUTH_URL'] as const)(
  '%s requires a secure canonical origin even with explicit HTTPS MCP',
  (key) => {
    for (const value of [
      'http://devpush.example',
      'http://192.168.1.2:7429',
      'ftp://devpush.example',
      'https://user:secret@devpush.example',
      'https://devpush.example/path',
      'https://devpush.example?',
      'https://devpush.example#',
    ]) {
      expect(() =>
        parseConfig({
          [key]: value,
          DEVPUSH_MCP_URL: 'https://devpush.example/mcp',
        }),
      ).toThrow()
    }
    for (const value of [
      'https://devpush.example',
      'http://localhost:7429',
      'http://app.localhost:7429',
      'http://127.0.0.2:7429',
      'http://[::1]:7429',
      'http://host.lima.internal:7429',
    ]) {
      expect(parseConfig({ [key]: value })[key]).toBe(value)
    }
  },
)
