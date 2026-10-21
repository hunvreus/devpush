import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export function isClientDisconnect(
  error: unknown,
  request: Pick<IncomingMessage, 'aborted'>,
  response: Pick<ServerResponse, 'destroyed'>,
) {
  if (!request.aborted && !response.destroyed) return false
  return isConnectionReset(error)
}

function isConnectionReset(error: unknown) {
  let cause = error
  const seen = new Set<unknown>()
  while (cause && typeof cause === 'object' && !seen.has(cause)) {
    seen.add(cause)
    const item = cause as { code?: string; cause?: unknown }
    if (item.code === 'ECONNRESET') return true
    cause = item.cause
  }
  return false
}

// Nitro forwards request errors into Vite, whose error handler broadcasts them
// to all tabs. A client that has already disconnected needs no error response.
export function clientDisconnectPlugin(): Plugin {
  return {
    name: 'devpush:client-disconnect',
    apply: 'serve',
    enforce: 'post',
    configureServer(server) {
      return () => {
        server.middlewares.use(function clientDisconnect(
          error: unknown,
          request: IncomingMessage,
          response: ServerResponse,
          next: (error?: unknown) => void,
        ) {
          if (isClientDisconnect(error, request, response)) return
          const pathname = request.url?.split('?')[0] ?? '/'
          server.config.logger.error(
            `Development request failed${isConnectionReset(error) ? ' (ECONNRESET)' : ''}: ${request.method} ${pathname} (aborted=${request.aborted}, responseDestroyed=${response.destroyed})`,
          )
          // A failed agent HTTP request must remain a failure, but broadcasting
          // its transport reset as an HMR overlay breaks unrelated browser tabs.
          if (
            pathname.startsWith('/api/agents/') &&
            isConnectionReset(error) &&
            !response.headersSent
          ) {
            response.statusCode = 502
            response.setHeader('Content-Type', 'application/json')
            response.setHeader('Cache-Control', 'no-store')
            response.end(
              JSON.stringify({
                error: 'Agent request connection reset. Retry the request.',
              }),
            )
            return
          }
          next(error)
        })
      }
    },
  }
}
