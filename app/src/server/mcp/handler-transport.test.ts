import { beforeEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import type * as McpSdk from '@modelcontextprotocol/server'
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server'
import { handleMcpRequest } from './handler'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  server: null as McpSdk.McpServer | null,
}))
vi.mock('@modelcontextprotocol/server', async (importOriginal) => {
  const actual = await importOriginal<typeof McpSdk>()
  return {
    ...actual,
    createMcpHandler: (
      ...[factory, options]: Parameters<typeof actual.createMcpHandler>
    ) =>
      actual.createMcpHandler(async (context) => {
        const product = await factory(context)
        if (product instanceof actual.McpServer) mocks.server = product
        return product
      }, options),
  }
})
vi.mock('#devpush/server/api/operation-contract', () => ({
  publicApiOperations: [
    {
      id: 'probe',
      description: 'Transport lifecycle probe',
      mcp: true,
      readOnly: true,
      scope: 'projects:read',
      input: z.strictObject({}),
      output: z.strictObject({ value: z.literal('done') }),
    },
  ],
}))
vi.mock('#devpush/server/api/operations', () => ({
  executeApiOperation: mocks.execute,
}))
vi.mock('#devpush/server/api/authorization', () => ({
  requireApiScope: () => {},
}))
vi.mock('#devpush/server/api/credentials', () => ({
  authenticateApiKey: async () => ({ credentialId: 'test' }),
}))
vi.mock('#devpush/server/http/rate-limit', () => ({
  enforceRateLimit: async () => null,
}))
vi.mock('#devpush/server/auth/better-auth', () => ({ auth: { api: {} } }))
vi.mock('./oauth-provider', () => ({
  mcpOAuthScopes: [],
  mcpResource: 'https://example.test/mcp',
}))
vi.mock('#devpush/server/config', () => ({
  config: {
    DEVPUSH_MCP_URL: 'https://example.test/mcp',
    DEVPUSH_BASE_URL: 'https://example.test',
    BETTER_AUTH_URL: 'https://example.test',
  },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.server = null
})

function request(version: '2025-11-25' | '2026-07-28', signal?: AbortSignal) {
  const modern = version === '2026-07-28'
  return new Request('https://example.test/mcp', {
    method: 'POST',
    signal,
    headers: {
      authorization: 'Bearer dp_test',
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': version,
      ...(modern ? { 'mcp-method': 'tools/call', 'mcp-name': 'probe' } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'probe',
        arguments: {},
        ...(modern
          ? {
              _meta: {
                [PROTOCOL_VERSION_META_KEY]: version,
                [CLIENT_INFO_META_KEY]: {
                  name: 'Lifecycle test',
                  version: '1',
                },
                [CLIENT_CAPABILITIES_META_KEY]: {},
              },
            }
          : {}),
      },
    }),
  })
}

test.each(['2025-11-25', '2026-07-28'] as const)(
  'real SDK delivers a delayed result (%s)',
  async (version) => {
    mocks.execute.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { data: { value: 'done' } }
    })
    const response = await handleMcpRequest(request(version))
    expect(response.status).toBe(200)
    if (version === '2025-11-25')
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      )
    expect(await response.text()).toContain('"value":"done"')
  },
)

test('modern auto-SSE keeps the serving instance until the final result', async () => {
  let finish!: () => void
  mocks.execute.mockImplementation(async () => {
    await mocks.server!.server.notification(
      {
        method: 'notifications/progress',
        params: { progressToken: 'probe', progress: 1, total: 2 },
      },
      { relatedRequestId: 7 },
    )
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return { data: { value: 'done' } }
  })
  const response = await handleMcpRequest(request('2026-07-28'))
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  expect(response.headers.get('cache-control')).toBe('no-store, no-transform')
  finish()
  expect(await response.text()).toContain('"value":"done"')
})

test('canceling a real SDK progress stream closes its serving instance', async () => {
  let finish!: () => void
  mocks.execute.mockImplementation(async () => {
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    await mocks.server!.server.notification(
      {
        method: 'notifications/progress',
        params: { progressToken: 'probe', progress: 1 },
      },
      { relatedRequestId: 7 },
    )
    await pending
    return { data: { value: 'done' } }
  })
  const response = await handleMcpRequest(request('2026-07-28'))
  const closed = vi.fn(mocks.server!.server.onclose)
  mocks.server!.server.onclose = closed
  await response.body!.cancel('Client disconnected')
  finish()
  expect(closed).toHaveBeenCalled()
})
