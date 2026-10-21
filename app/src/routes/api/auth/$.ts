import { createFileRoute } from '@tanstack/react-router'

import { auth } from '@/server/auth/better-auth'
import { enforceRateLimit } from '@/server/http/rate-limit'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => auth.handler(externalAuthRequest(request)),
      POST: async ({ request }) => {
        const tokenExchange =
          new URL(request.url).pathname === '/api/auth/oauth2/token'
        const limited = await enforceRateLimit({
          limit: tokenExchange ? 300 : 30,
          request,
          scope: tokenExchange ? 'auth-token' : 'auth',
          windowMs: 5 * 60 * 1000,
        })

        return limited ?? auth.handler(externalAuthRequest(request))
      },
    },
  },
})

function externalAuthRequest(request: Request) {
  const headers = new Headers(request.headers)
  headers.delete('x-devpush-mcp-grant')
  // Node's server request can be a framework wrapper rather than a native Fetch Request.
  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    duplex: 'half',
  }
  return new Request(request.url, init)
}
