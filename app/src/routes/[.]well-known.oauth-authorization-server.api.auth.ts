import { createFileRoute } from '@tanstack/react-router'
import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { auth } from '@/server/auth/better-auth'

export const Route = createFileRoute(
  '/.well-known/oauth-authorization-server/api/auth',
)({
  server: {
    handlers: {
      GET: ({ request }) => oauthProviderAuthServerMetadata(auth)(request),
    },
  },
})
