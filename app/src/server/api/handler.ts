import { ZodError } from 'zod'
import { PublicError } from '#devpush/lib/public-error'
import { enforceRateLimit } from '#devpush/server/http/rate-limit'
import {
  readRequestText,
  RequestBodyTooLargeError,
} from '#devpush/server/http/request-body'
import { authenticateApiKey } from './credentials'
import { ApiError } from './errors'
import {
  createPublicOpenApiDocument,
  publicApiOperations,
} from './operation-contract'
import type { PublicApiOperation } from './operation-contract'
import { executeApiOperation } from './operations'
import { safeErrorDiagnostics } from '#devpush/server/http/error-diagnostics'

const apiBodyLimit = 128 * 1024

export async function handlePublicApiRequest(request: Request) {
  const requestId = crypto.randomUUID()
  const headers = {
    'cache-control': 'no-store',
    'x-request-id': requestId,
    vary: 'Authorization',
  }
  let operationContext:
    | { operationId: string; route: string; method: string }
    | undefined
  try {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) throw new PublicError('FORBIDDEN')
    const path = url.pathname.replace(/^\/api\/v1/, '').replace(/\/$/, '')
    if (path === '/openapi.json' && request.method === 'GET')
      return Response.json(createPublicOpenApiDocument(), { headers })
    const matches = publicApiOperations.flatMap((operation) => {
      const params = matchPublicApiPath(operation.path, path)
      return params ? [{ operation, params }] : []
    })
    const match = matches.find(
      ({ operation }) => operation.method === request.method,
    )
    if (!match) {
      if (matches.length)
        return Response.json(
          apiErrorBody(new ApiError('METHOD_NOT_ALLOWED', 405), requestId),
          {
            status: 405,
            headers: {
              ...headers,
              allow: matches
                .map(({ operation }) => operation.method)
                .join(', '),
            },
          },
        )
      throw new ApiError('NOT_FOUND', 404)
    }
    operationContext = {
      operationId: match.operation.id,
      route: `/api/v1${match.operation.path}`,
      method: match.operation.method,
    }
    const limited = await enforceRateLimit({
      request,
      scope: 'public-api-auth',
      limit: 240,
      windowMs: 60_000,
    })
    if (limited)
      return Response.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Try again later.',
            requestId,
          },
        },
        {
          status: 429,
          headers: {
            ...headers,
            'retry-after': limited.headers.get('retry-after') ?? '60',
          },
        },
      )
    const principal = await authenticateApiKey(request)
    const input = await publicApiRequestInput(
      request,
      url,
      match.operation,
      match.params,
    )
    const result = await executeApiOperation({
      operationId: match.operation.id,
      input,
      principal,
      requestId,
    })
    return Response.json(result.data, { status: result.status, headers })
  } catch (error) {
    const status = apiErrorStatus(error)
    if (status === 500)
      console.error('Public API request failed', {
        requestId,
        ...operationContext,
        ...safeErrorDiagnostics(error),
      })
    return Response.json(apiErrorBody(error, requestId), {
      status,
      headers: status === 429 ? { ...headers, 'retry-after': '60' } : headers,
    })
  }
}

function matchPublicApiPath(template: string, actual: string) {
  const expected = template.split('/')
  const values = actual.split('/')
  if (expected.length !== values.length) return null
  const params: Record<string, string> = Object.create(null)
  for (let index = 0; index < expected.length; index++) {
    const segment = expected[index]!
    const value = values[index]!
    const variable = /^\{([a-zA-Z]+)\}$/.exec(segment)
    if (variable) {
      try {
        const decoded = decodeURIComponent(value)
        if (!decoded || decoded.includes('/') || decoded.includes('\0'))
          return null
        params[variable[1]!] = decoded
      } catch {
        return null
      }
    } else if (segment !== value) return null
  }
  return params
}

async function publicApiRequestInput(
  request: Request,
  url: URL,
  operation: PublicApiOperation,
  params: Record<string, string>,
) {
  // Preserve every supplied key, including __proto__, for strict validation.
  const input: Record<string, unknown> = Object.create(null)
  if (operation.readOnly) {
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(input, key) || Object.hasOwn(params, key))
        throw new PublicError('INVALID_INPUT')
      input[key] = value
    }
  } else {
    if (url.search) throw new PublicError('INVALID_INPUT')
    const text = await readRequestText(request, apiBodyLimit)
    if (text) {
      if (
        request.headers
          .get('content-type')
          ?.split(';')[0]
          ?.trim()
          .toLowerCase() !== 'application/json'
      )
        throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 415)
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        throw new PublicError('INVALID_INPUT')
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new PublicError('INVALID_INPUT')
      for (const [key, value] of Object.entries(body)) {
        if (Object.hasOwn(params, key) || key === 'idempotencyKey')
          throw new PublicError('INVALID_INPUT')
        input[key] = value
      }
    }
    const idempotencyKey = request.headers.get('idempotency-key')
    if (!idempotencyKey?.trim()) throw new ApiError('IDEMPOTENCY_REQUIRED', 400)
    input.idempotencyKey = idempotencyKey
  }
  const assembled = { ...input, ...params }
  // Zod intentionally ignores __proto__ rather than reporting it as an
  // unknown key. Reject it here so malformed requests cannot become valid.
  if (Object.hasOwn(assembled, '__proto__'))
    throw new ZodError([
      {
        code: 'unrecognized_keys',
        keys: ['__proto__'],
        path: [],
        message: 'Unrecognized key.',
      },
    ])
  return assembled
}

function apiErrorStatus(error: unknown) {
  if (error instanceof ApiError) return error.status
  if (error instanceof RequestBodyTooLargeError) return 413
  if (error instanceof ZodError) return 422
  if (!(error instanceof PublicError)) return 500
  if (error.code === 'UNAUTHORIZED') return 401
  if (error.code === 'FORBIDDEN' || error.code.endsWith('_FORBIDDEN'))
    return 403
  if (error.code === 'RATE_LIMITED') return 429
  if (
    error.code === 'WORKSPACE_RESTRICTED' ||
    error.code === 'WORKSPACE_LIMIT_REACHED'
  )
    return 403
  if (error.code === 'RESOURCE_BUSY') return 409
  if (
    error.code.endsWith('_NOT_FOUND') ||
    error.code === 'PROJECT_ACCESS_CHANGED'
  )
    return 404
  if (error.code === 'INTERNAL_ERROR') return 500
  if (
    error.code.endsWith('_CONFLICT') ||
    error.code.endsWith('_CHANGED') ||
    error.code.endsWith('_ACTIVE') ||
    error.code === 'BACKUP_STORAGE_IN_USE'
  )
    return 409
  return 400
}

export function apiErrorBody(error: unknown, requestId: string) {
  if (error instanceof ApiError || error instanceof PublicError)
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error instanceof PublicError && error.policy
          ? { policy: error.policy }
          : {}),
      },
    }
  if (error instanceof RequestBodyTooLargeError)
    return {
      error: {
        code: 'REQUEST_TOO_LARGE',
        message: 'The request body is too large.',
        requestId,
      },
    }
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = Object.create(null)
    for (const issue of error.issues.slice(0, 20)) {
      const path = issue.path.map(String).join('.').slice(0, 256) || 'input'
      fieldErrors[path] ??= []
      // Zod may mention supplied values in issue messages; use a fixed message.
      fieldErrors[path].push('Invalid value.')
    }
    return {
      error: {
        code: 'INVALID_INPUT',
        message: 'Check the entered values and try again.',
        requestId,
        fieldErrors,
      },
    }
  }
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Unable to complete this action. Please try again.',
      requestId,
    },
  }
}
