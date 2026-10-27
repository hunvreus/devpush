import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { isAPIError as isAuthApiError } from 'better-auth/api'
import { safeErrorDiagnostics } from '#devpush/server/http/error-diagnostics'
import { auth } from '#devpush/server/auth/better-auth'
import { PublicError, getPublicErrorMessage } from '#devpush/lib/public-error'
import { authenticateApiKey } from '#devpush/server/api/credentials'
import type { ApiPrincipal } from '#devpush/server/api/authorization'
import { requireApiScope } from '#devpush/server/api/authorization'
import { ApiError } from '#devpush/server/api/errors'
import { executeApiOperation } from '#devpush/server/api/operations'
import { publicApiOperations } from '#devpush/server/api/operation-contract'
import { config } from '#devpush/server/config'
import { enforceRateLimit } from '#devpush/server/http/rate-limit'
import { mcpOAuthScopes, mcpResource } from './oauth-provider'
import { createMcpUrls } from './urls'

const { origins, metadata } = createMcpUrls(config)
const mcpResourceMetadataUrl = metadata

export function getMcpResourceMetadata() {
  return Response.json(
    {
      resource: mcpResource,
      resource_name: 'devpush MCP',
      authorization_servers: [
        new URL('/api/auth', config.BETTER_AUTH_URL).toString(),
      ],
      bearer_methods_supported: ['header'],
      scopes_supported: [...mcpOAuthScopes],
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  )
}

export async function authenticateMcpRequest(
  request: Request,
): Promise<ApiPrincipal> {
  const authorization = request.headers.get('authorization') ?? ''
  if (/^Bearer dp_/i.test(authorization)) return authenticateApiKey(request)
  const token = authorization.match(/^Bearer ([^\s]+)$/i)?.[1]
  if (!token) throw new PublicError('UNAUTHORIZED')
  // Provider-owned verification checks cryptographic validity, audience, active
  // session/client/token family, and our current stored consent and grant.
  return auth.api.verifyMcpAccessToken({ body: { token } })
}

function createDevpushMcpHandler(principal: ApiPrincipal, requestId: string) {
  return createMcpHandler(
    () => {
      const server = new McpServer(
        { name: 'devpush', version: '1.0.0' },
        { maxToolInputElements: 4096 },
      )
      for (const operation of publicApiOperations.filter((entry) => {
        if (
          !entry.mcp ||
          (entry.requiresWholeTeam && principal.projectIds !== null)
        )
          return false
        try {
          requireApiScope(principal, entry.scope, entry.minimumRole)
          return true
        } catch {
          return false
        }
      })) {
        const addConfirmation =
          operation.destructive && !('confirmation' in operation.input.shape)
        const inputSchema = addConfirmation
          ? operation.input.extend({ confirmation: z.literal(operation.id) })
          : operation.input
        server.registerTool(
          operation.id,
          {
            description: operation.description,
            inputSchema,
            outputSchema: operation.output,
            annotations: {
              readOnlyHint: operation.readOnly,
              destructiveHint: operation.destructive,
              idempotentHint:
                operation.readOnly || 'idempotencyKey' in operation.input.shape,
              openWorldHint: !operation.readOnly,
            },
          },
          async (args) => {
            const input = { ...args }
            if (addConfirmation) delete input.confirmation
            try {
              const result = await executeApiOperation({
                operationId: operation.id,
                input,
                principal,
                requestId,
              })
              const output = result.data as Record<string, unknown>
              return {
                content: [
                  { type: 'text' as const, text: JSON.stringify(output) },
                ],
                structuredContent: output,
              }
            } catch (error) {
              const code =
                error instanceof ApiError || error instanceof PublicError
                  ? error.code
                  : error instanceof z.ZodError
                    ? 'INVALID_INPUT'
                    : 'INTERNAL_ERROR'
              const message =
                error instanceof ApiError
                  ? error.message
                  : getPublicErrorMessage(
                      error,
                      'Unable to complete this operation.',
                    )
              if (code === 'INTERNAL_ERROR')
                console.error('MCP operation failed', {
                  requestId,
                  operation: operation.id,
                })
              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      error: { code, message, requestId },
                    }),
                  },
                ],
              }
            }
          },
        )
      }
      return server
    },
    {
      legacy: 'stateless',
      responseMode: 'auto',
      maxRequestBodySize: 128 * 1024,
      maxSubscriptions: 0,
    },
  )
}

export async function handleMcpRequest(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && !origins.has(origin))
    return Response.json({ error: 'Origin is not allowed.' }, { status: 403 })
  if (!origins.has(new URL(request.url).origin))
    return Response.json({ error: 'Host is not allowed.' }, { status: 403 })
  const cors: Record<string, string> = origin
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
        'access-control-allow-headers':
          'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, MCP-Method, MCP-Name',
        'access-control-expose-headers':
          'WWW-Authenticate, MCP-Protocol-Version',
        vary: 'Origin',
      }
    : {}
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: cors })
  const requestId = crypto.randomUUID()
  function withResponseHeaders(response: Response) {
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(cors)) {
      if (name === 'vary') headers.append(name, value)
      else headers.set(name, value)
    }
    headers.set(
      'cache-control',
      response.headers.get('content-type')?.startsWith('text/event-stream')
        ? 'no-store, no-transform'
        : 'no-store',
    )
    headers.set('x-request-id', requestId)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
  const transportLimited = await enforceRateLimit({
    request,
    scope: 'mcp-transport',
    limit: 180,
    windowMs: 60_000,
  })
  if (transportLimited) return withResponseHeaders(transportLimited)
  let principal: ApiPrincipal
  try {
    principal = await authenticateMcpRequest(request)
  } catch (error) {
    const invalidCredentials =
      (error instanceof PublicError &&
        ['UNAUTHORIZED', 'FORBIDDEN'].includes(error.code)) ||
      (isAuthApiError(error) &&
        error.statusCode >= 400 &&
        error.statusCode < 500)
    if (!invalidCredentials) {
      console.error('MCP authentication failed', {
        requestId,
        ...safeErrorDiagnostics(error),
      })
      return withResponseHeaders(
        Response.json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Unable to authenticate this request. Try again.',
              requestId,
            },
          },
          { status: 500 },
        ),
      )
    }
    return Response.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message:
            'Provide a valid API key or connect through browser authorization.',
          requestId,
        },
      },
      {
        status: 401,
        headers: {
          ...cors,
          'www-authenticate': `Bearer resource_metadata="${mcpResourceMetadataUrl}"`,
          'cache-control': 'no-store',
          'x-request-id': requestId,
        },
      },
    )
  }
  const limited = await enforceRateLimit({
    request,
    scope: `mcp:${principal.credentialId}`,
    limit: 120,
    windowMs: 60_000,
  })
  if (limited) return withResponseHeaders(limited)
  const handler = createDevpushMcpHandler(principal, requestId)
  let closing: Promise<void> | undefined
  const close = () => (closing ??= handler.close())
  try {
    const response = await handler.fetch(request)
    if (
      response.body &&
      response.headers.get('content-type')?.startsWith('text/event-stream')
    ) {
      const reader = response.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read()
            if (chunk.done) {
              controller.close()
              await close()
            } else controller.enqueue(chunk.value)
          } catch (error) {
            controller.error(error)
            await close()
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason)
          } finally {
            await close()
          }
        },
      })
      return withResponseHeaders(
        new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
      )
    }
    await close()
    return withResponseHeaders(response)
  } catch (error) {
    await close()
    throw error
  }
}
