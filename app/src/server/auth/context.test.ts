import { beforeEach, expect, test, vi } from 'vitest'
import { getLoginContext } from './context'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  userContext: vi.fn(),
}))
vi.mock('#devpush/server/auth/auth-methods', () => ({
  getAuthMethods: () => ({ email: true, github: false, google: false }),
}))
vi.mock('#devpush/server/auth/session.server', () => ({
  getAuthSession: mocks.session,
}))
vi.mock('#devpush/server/teams/service', () => ({
  getUserContext: mocks.userContext,
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (handler: () => unknown) => handler }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue(null)
})

test('signed-in context loads', async () => {
  mocks.session.mockResolvedValue({ user: { id: 'user' } })
  mocks.userContext.mockResolvedValue({ user: { id: 'user' } })
  expect(await getLoginContext()).toMatchObject({
    userContext: { user: { id: 'user' } },
  })
  expect(mocks.userContext).toHaveBeenCalledWith('user')
})
