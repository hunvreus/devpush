import { beforeEach, expect, test, vi } from 'vitest'
import { handleMcpRequest } from './handler'
import { APIError } from 'better-auth/api'
import { PublicError } from '@/lib/public-error'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  close: vi.fn(),
  authenticate: vi.fn(),
  limit: vi.fn(),
}))
vi.mock('@modelcontextprotocol/server', () => ({
  createMcpHandler: () => ({ fetch: mocks.fetch, close: mocks.close }),
  McpServer: class {},
}))
vi.mock('@/server/auth/better-auth', () => ({ auth: { api: {} } }))
vi.mock('@/server/api/credentials', () => ({
  authenticateApiKey: mocks.authenticate,
}))
vi.mock('@/server/api/operations', () => ({ executeApiOperation: vi.fn() }))
vi.mock('@/server/api/operation-contract', () => ({ publicApiOperations: [] }))
vi.mock('@/server/http/rate-limit', () => ({ enforceRateLimit: mocks.limit }))
vi.mock('./oauth-provider', () => ({
  mcpOAuthScopes: [],
  mcpResource: 'https://example.test/mcp',
}))
vi.mock('@/server/config', () => ({
  config: {
    DEVPUSH_MCP_URL: 'https://example.test/mcp',
    DEVPUSH_BASE_URL: 'https://example.test',
    BETTER_AUTH_URL: 'https://example.test',
  },
}))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  mocks.authenticate.mockResolvedValue({ credentialId: 'key-1' })
  mocks.limit.mockResolvedValue(null)
  mocks.close.mockResolvedValue(undefined)
  mocks.fetch.mockResolvedValue(new Response('result'))
})

test.each([
  new PublicError('UNAUTHORIZED'),
  new APIError('UNAUTHORIZED'),
  // Production's lazy auth bundle can own a different APIError constructor.
  Object.assign(new Error('Invalid OAuth access token'), {
    name: 'APIError',
    statusCode: 401,
  }),
])(
  'invalid credentials retain the authentication challenge (%s)',
  async (error) => {
    mocks.authenticate.mockRejectedValue(error)
    const response = await handleMcpRequest(request())
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata',
    )
  },
)

test.each([
  new Error('private database diagnostic'),
  Object.assign(new Error('private database diagnostic'), {
    name: 'APIError',
    statusCode: 500,
  }),
])(
  'unexpected authentication failure is a server error without a reauthorization challenge',
  async (error) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.authenticate.mockRejectedValue(error)
    const response = await handleMcpRequest(request())
    expect(response.status).toBe(500)
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://example.test',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('private database diagnostic')
    expect(log).toHaveBeenCalled()
  },
)

function request() {
  return new Request('https://example.test/mcp', {
    method: 'POST',
    headers: {
      origin: 'https://example.test',
      authorization: 'Bearer dp_test',
    },
  })
}

test.each([1, 2])(
  'rate limit %i keeps CORS, request ID and retry headers',
  async (position) => {
    if (position === 2) mocks.limit.mockResolvedValueOnce(null)
    mocks.limit.mockResolvedValueOnce(
      new Response('limited', {
        status: 429,
        headers: { 'retry-after': '60' },
      }),
    )
    const response = await handleMcpRequest(request())
    expect(response.status).toBe(429)
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://example.test',
    )
    expect(response.headers.get('vary')).toContain('Origin')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(response.headers.get('retry-after')).toBe('60')
    expect(mocks.fetch).not.toHaveBeenCalled()
  },
)

test('transport is closed when serving rejects', async () => {
  const error = new Error('transport failed')
  mocks.fetch.mockRejectedValue(error)
  await expect(handleMcpRequest(request())).rejects.toBe(error)
  expect(mocks.close).toHaveBeenCalledOnce()
})

test('successful transport keeps response body and closes serving instance', async () => {
  const response = await handleMcpRequest(request())
  expect(await response.text()).toBe('result')
  expect(mocks.close).toHaveBeenCalledOnce()
  expect(response.headers.get('cache-control')).toBe('no-store')
})
