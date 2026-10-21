import { beforeEach, expect, test, vi } from 'vitest'
import { Route } from '@/routes/api/auth/$'

const mocks = vi.hoisted(() => ({ handler: vi.fn(), limit: vi.fn() }))
vi.mock('@/server/auth/better-auth', () => ({
  auth: { handler: mocks.handler },
}))
vi.mock('@/server/http/rate-limit', () => ({ enforceRateLimit: mocks.limit }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.limit.mockResolvedValue(null)
  mocks.handler.mockResolvedValue(new Response('ok'))
})
function post(request: Request) {
  const handlers = Route.options.server?.handlers
  if (
    !handlers ||
    typeof handlers === 'function' ||
    typeof handlers.POST !== 'function'
  )
    throw new Error('Missing POST')
  return Reflect.apply(
    handlers.POST as (...args: unknown[]) => unknown,
    undefined,
    [{ request }],
  )
}
test.each([
  ['oauth2/token', 300, 'auth-token'],
  ['sign-in/email-otp', 30, 'auth'],
])('limits %s independently', async (path, limit, scope) => {
  await post(
    new Request(`http://localhost/api/auth/${path}`, {
      method: 'POST',
      headers: { 'x-devpush-mcp-grant': 'spoofed' },
      body: 'client_id=test',
    }),
  )
  expect(mocks.limit).toHaveBeenCalledWith(
    expect.objectContaining({ limit, scope }),
  )
  const passed = mocks.handler.mock.calls[0]![0] as Request
  expect(passed.headers.has('x-devpush-mcp-grant')).toBe(false)
  expect(await passed.text()).toBe('client_id=test')
})

test('auth accepts the runtime-neutral request wrapper used by Node', async () => {
  const original = new Request('http://localhost/api/auth/oauth2/token', {
    method: 'POST',
    body: 'client_id=wrapper',
  })
  const wrapper = {
    url: original.url,
    method: original.method,
    headers: original.headers,
    body: original.body,
    signal: original.signal,
  } as Request
  await post(wrapper)
  expect(await (mocks.handler.mock.calls[0]![0] as Request).text()).toBe(
    'client_id=wrapper',
  )
})
