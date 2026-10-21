import { describe, expect, test, vi } from 'vitest'
import { auth } from './better-auth'

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(() => ({ api: { fixture: true }, handler: vi.fn() })),
}))
vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  betterAuth: mocks.initialize,
}))

describe('auth initialization', () => {
  test('importing the auth facade performs no provider initialization or resource seeding', () => {
    expect(mocks.initialize).not.toHaveBeenCalled()
    expect(auth).toBeDefined()
  })
  test('the first request access initializes once and subsequent access reuses the provider', () => {
    const api = auth.api
    expect(mocks.initialize).toHaveBeenCalledTimes(1)
    expect(auth.api).toBe(api)
    expect(mocks.initialize).toHaveBeenCalledTimes(1)
  })
})
