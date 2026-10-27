import type { BetterAuthPlugin } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api'
import { PublicError } from '#devpush/lib/public-error'
import { isEmailAllowlisted } from './access'

export async function assertAllowedEmailChange(email: string) {
  if (!(await isEmailAllowlisted(email)))
    throw new PublicError('ACCOUNT_EMAIL_NOT_ALLOWED')
}

export async function assertAllowedAuthEmailChange(email: string) {
  try {
    await assertAllowedEmailChange(email)
  } catch (error) {
    if (error instanceof PublicError)
      throw new APIError('FORBIDDEN', {
        code: error.code,
        message: error.message,
      })
    throw error
  }
}

export function requireAllowedEmailChanges(): BetterAuthPlugin {
  return {
    id: 'devpush-allowed-email-changes',
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === '/change-email',
          handler: createAuthMiddleware(async (ctx) => {
            // Avoid exposing policy to anonymous callers and honor live revocation.
            if (!(await getSessionFromCtx(ctx, { disableCookieCache: true })))
              throw new APIError('UNAUTHORIZED')
            const email: unknown = ctx.body?.newEmail
            if (typeof email === 'string')
              await assertAllowedAuthEmailChange(email)
          }),
        },
      ],
    },
  }
}
