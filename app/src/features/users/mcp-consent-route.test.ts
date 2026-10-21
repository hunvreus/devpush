import { expect, test, vi } from 'vitest'
import { Route } from '@/routes/oauth.consent'

const mocks = vi.hoisted(() => ({
  consent: vi.fn(),
  redirect: vi.fn((options: unknown) => options),
}))
vi.mock('@/server/mcp/functions', () => ({
  getMcpConsentAction: mocks.consent,
  completeMcpConsentAction: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: mocks.redirect,
}))
const signedQuery =
  'client_id=test&ba_param=first&ba_param=second&state=%22hello%22&sig=a%2Bb%3D'
function loader() {
  const value = Route.options.loader
  if (typeof value !== 'function') throw new Error('Missing consent loader')
  return (deps: { oauthQuery: string }) =>
    Reflect.apply(value, undefined, [{ deps }])
}
function handler() {
  const handlers = Route.options.server?.handlers
  if (
    !handlers ||
    typeof handlers === 'function' ||
    typeof handlers.GET !== 'function'
  )
    throw new Error('Missing consent GET handler')
  return (request: Request, next: () => unknown) =>
    Reflect.apply(handlers.GET as (...args: unknown[]) => unknown, undefined, [
      { request, next },
    ])
}
test('wraps the exact signed query before router normalization', async () => {
  const next = vi.fn()
  const response = (await handler()(
    new Request('http://localhost:7429/oauth/consent?' + signedQuery),
    next,
  )) as Response
  expect(response.status).toBe(302)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const target = new URL(
    response.headers.get('location')!,
    'http://localhost:7429',
  )
  expect(target.searchParams.size).toBe(1)
  expect(target.searchParams.get('oauthQuery')).toBe(signedQuery)
  expect(next).not.toHaveBeenCalled()
})
test.each([
  '?oauthQuery=extra&client_id=test',
  '?oauthQuery=first&oauthQuery=second',
])(
  'wraps mixed or duplicate parameters before validation %s',
  async (query) => {
    const next = vi.fn()
    const response = (await handler()(
      new Request('http://localhost:7429/oauth/consent' + query),
      next,
    )) as Response
    expect(response.status).toBe(302)
    const target = new URL(
      response.headers.get('location')!,
      'http://localhost:7429',
    )
    expect(target.searchParams.size).toBe(1)
    expect(target.searchParams.get('oauthQuery')).toBe(query.slice(1))
    expect(next).not.toHaveBeenCalled()
  },
)
test.each([
  '',
  '?oauthQuery=',
  '?oauthQuery=' + encodeURIComponent(signedQuery),
])('does not redirect empty or already wrapped queries %s', async (query) => {
  const next = vi.fn(() => 'render')
  expect(
    await handler()(
      new Request('http://localhost:7429/oauth/consent' + query),
      next,
    ),
  ).toBe('render')
  expect(next).toHaveBeenCalledTimes(1)
})
test('forwards the complete query through a login redirect and return', async () => {
  mocks.consent.mockResolvedValueOnce(null)
  const run = loader()
  await expect(run({ oauthQuery: signedQuery })).rejects.toMatchObject({
    to: '/auth/login',
    search: {
      redirect: '/oauth/consent?oauthQuery=' + encodeURIComponent(signedQuery),
    },
  })
  mocks.consent.mockResolvedValueOnce({ clientName: 'Test' })
  await run({ oauthQuery: signedQuery })
  expect(mocks.consent).toHaveBeenLastCalledWith({
    data: { oauthQuery: signedQuery },
  })
})
