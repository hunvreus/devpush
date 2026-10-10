import { createFileRoute } from '@tanstack/react-router'

import { auth } from '@/lib/auth'
import { enforceRateLimit } from '@/server/http/rate-limit'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => auth.handler(request),
      POST: async ({ request }) => {
        const limited = await enforceRateLimit({
          limit: 30,
          request,
          scope: 'auth',
          windowMs: 5 * 60 * 1000,
        })

        return limited ?? auth.handler(request)
      },
    },
  },
})
