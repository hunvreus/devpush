import { describe, expect, test } from 'vitest'

import { parseConfig } from './config'

describe('server config', () => {
  test('uses the local origin for both base URLs by default', () => {
    const config = parseConfig({})

    expect(config.DEVPUSH_BASE_URL).toBe('http://localhost:7429')
    expect(config.BETTER_AUTH_URL).toBe('http://localhost:7429')
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
})
