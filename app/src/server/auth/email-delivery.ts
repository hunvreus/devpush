import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'

export function requireAuthEmailDelivery(): BetterAuthPlugin {
  return {
    id: 'require-auth-email-delivery',
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            [
              '/email-otp/send-verification-otp',
              '/change-email',
              '/send-verification-email',
            ].includes(ctx.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => ({
            context: {
              context: {
                // Better Auth's default helper logs and swallows send failures.
                // Override only this request: success must mean sending succeeded.
                runInBackgroundOrAwait: async (
                  task: Promise<unknown> | void,
                ) => {
                  try {
                    await task
                  } catch (error) {
                    ctx.context.logger.error(
                      'Failed to send authentication email',
                      error,
                    )
                    throw new APIError('SERVICE_UNAVAILABLE', {
                      code:
                        ctx.path === '/email-otp/send-verification-otp'
                          ? 'OTP_SEND_FAILED'
                          : 'EMAIL_SEND_FAILED',
                      message:
                        ctx.path === '/email-otp/send-verification-otp'
                          ? 'Unable to send your sign-in code. Please try again in a moment.'
                          : 'Unable to send the verification email. Please try again in a moment.',
                    })
                  }
                },
              },
            },
          })),
        },
      ],
    },
  }
}
