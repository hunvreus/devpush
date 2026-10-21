import { beforeEach, expect, test, vi } from 'vitest'
import { getLoginContext } from './context'

const mocks = vi.hoisted(() => ({
  config: { DEVPUSH_SIGN_IN_MESSAGE: '' },
  session: vi.fn(),
  userContext: vi.fn(),
}))
vi.mock('@/server/config', () => ({ config: mocks.config }))
vi.mock('@/server/auth/auth-methods', () => ({
  getAuthMethods: () => ({ email: true, github: false, google: false }),
}))
vi.mock('@/server/auth/session.server', () => ({
  getAuthSession: mocks.session,
}))
vi.mock('@/server/teams/service', () => ({ getUserContext: mocks.userContext }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (handler: () => unknown) => handler }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.config.DEVPUSH_SIGN_IN_MESSAGE = ''
  mocks.session.mockResolvedValue(null)
})

test('public login reads the deployment notice without admin or settings storage', async () => {
  mocks.config.DEVPUSH_SIGN_IN_MESSAGE =
    'Employees only. https://example.com/access'
  expect(await getLoginContext()).toEqual({
    authMethods: { email: true, github: false, google: false },
    signInMessage: mocks.config.DEVPUSH_SIGN_IN_MESSAGE,
    userContext: null,
  })
  expect(mocks.userContext).not.toHaveBeenCalled()
})

test('a blank notice remains hidden and signed-in context still loads', async () => {
  mocks.session.mockResolvedValue({ user: { id: 'user' } })
  mocks.userContext.mockResolvedValue({ user: { id: 'user' } })
  expect(await getLoginContext()).toMatchObject({
    signInMessage: '',
    userContext: { user: { id: 'user' } },
  })
  expect(mocks.userContext).toHaveBeenCalledWith('user')
})
