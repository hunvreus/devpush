import { createMiddleware } from '@tanstack/react-start'
import { PublicError } from '@/lib/public-error'
import { ZodError } from 'zod'

export const publicErrorsMiddleware = createMiddleware({
  type: 'function',
}).server(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    throw publicErrorPayload(error)
  }
})

export function toPublicError(error: unknown): PublicError {
  if (error instanceof PublicError) return error
  if (
    error &&
    typeof error === 'object' &&
    (('status' in error && error.status === 429) ||
      ('statusCode' in error && error.statusCode === 429))
  )
    return new PublicError('RATE_LIMITED')
  if (error instanceof ZodError) return new PublicError('INVALID_INPUT')
  if (error instanceof Error && error.message === 'Forbidden')
    return new PublicError('FORBIDDEN')
  if (
    error instanceof Error &&
    (error.message === 'Unauthorized' ||
      error.message.startsWith('Sign in before '))
  )
    return new PublicError('UNAUTHORIZED')
  console.error('Server action failed', error)
  return new PublicError('INTERNAL_ERROR')
}

// Plain objects survive Start's default transport without per-window adapters.
export function publicErrorPayload(error: unknown) {
  const safe = toPublicError(error)
  return {
    name: 'PublicError' as const,
    code: safe.code,
    message: safe.message,
    ...(safe.reloadUrl ? { reloadUrl: safe.reloadUrl } : {}),
  }
}
