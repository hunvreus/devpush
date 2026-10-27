import { beforeEach, expect, test, vi } from 'vitest'
import { connectWorkspaceUpdates, notifyServer } from './service'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  namespace: vi.fn(),
  rows: vi.fn(),
}))
vi.mock('#devpush/server/auth/better-auth', () => ({
  auth: { api: { getSession: mocks.auth } },
}))
vi.mock('#devpush/server/runtime/platform-env', () => ({
  getWorkspaceUpdates: mocks.namespace,
}))
vi.mock('#devpush/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin() {
          return this
        },
        where() {
          return this
        },
        limit: mocks.rows,
      }),
    }),
  },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({
    user: { id: 'u' },
    session: { id: 'session', expiresAt: new Date(Date.now() + 60000) },
  })
  mocks.rows.mockResolvedValue([{ id: 'team' }])
})
test('rejects cross-origin sockets before session lookup', async () => {
  const response = await connectWorkspaceUpdates(
    new Request('https://app.test/api/workspaces/updates?team=a', {
      headers: { Upgrade: 'websocket', Origin: 'https://other.test' },
    }),
  )
  expect(response.status).toBe(403)
  expect(mocks.auth).not.toHaveBeenCalled()
})
test('requires a session and workspace membership', async () => {
  mocks.auth.mockResolvedValueOnce(null)
  expect(
    (
      await connectWorkspaceUpdates(
        new Request('https://app.test/api/workspaces/updates'),
      )
    ).status,
  ).toBe(401)
  mocks.rows.mockResolvedValueOnce([])
  expect(
    (
      await connectWorkspaceUpdates(
        new Request('https://app.test/api/workspaces/updates?team=a'),
      )
    ).status,
  ).toBe(404)
})
test('Node advertises polling and internal socket credentials replace supplied headers', async () => {
  const request = new Request('https://app.test/api/workspaces/updates?team=a')
  expect(await (await connectWorkspaceUpdates(request)).json()).toEqual({
    available: false,
  })
  const fetch = vi.fn().mockResolvedValue(new Response('socket'))
  mocks.namespace.mockReturnValue({
    getByName: vi.fn().mockReturnValue({ fetch }),
  })
  await connectWorkspaceUpdates(
    new Request(request.url, {
      headers: {
        Origin: 'https://app.test',
        Upgrade: 'websocket',
        'x-devpush-session': 'forged',
      },
    }),
  )
  expect(fetch.mock.calls[0]![0].headers.get('x-devpush-session')).toBe(
    'session',
  )
})
test('notification lookup failure never fails an acknowledged mutation', async () => {
  mocks.namespace.mockReturnValue({})
  mocks.rows.mockRejectedValueOnce(new Error('db unavailable'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(notifyServer('s', 'servers')).resolves.toBeUndefined()
  log.mockRestore()
})
