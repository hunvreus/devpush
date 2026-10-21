import { createAuthClient } from 'better-auth/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('better-auth/react', () => ({ createAuthClient: vi.fn(() => ({})) }))
vi.mock('better-auth/client/plugins', () => ({ emailOTPClient: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

test.each([
  [undefined, undefined, 'http://localhost:7429/api/auth'],
  ['', 'https://devpush.example.com', 'https://devpush.example.com/api/auth'],
  [
    '   ',
    'https://devpush.example.com',
    'https://devpush.example.com/api/auth',
  ],
  ['', '', 'http://localhost:7429/api/auth'],
  [
    'https://auth.example.com',
    'https://devpush.example.com',
    'https://auth.example.com/api/auth',
  ],
])('SSR auth URL handles auth=%j and base=%j', async (auth, base, expected) => {
  vi.resetModules()
  vi.stubGlobal('window', undefined)
  vi.stubEnv('BETTER_AUTH_URL', auth)
  vi.stubEnv('DEVPUSH_BASE_URL', base)
  await import('./client')
  expect(createAuthClient).toHaveBeenCalledWith(
    expect.objectContaining({ baseURL: expected }),
  )
})

test('browser auth uses the current origin', async () => {
  vi.resetModules()
  vi.stubGlobal('window', {
    location: { origin: 'https://browser.example.com' },
  })
  vi.stubEnv('BETTER_AUTH_URL', 'https://internal.example.com')
  await import('./client')
  expect(createAuthClient).toHaveBeenCalledWith(
    expect.objectContaining({
      baseURL: 'https://browser.example.com/api/auth',
    }),
  )
})
