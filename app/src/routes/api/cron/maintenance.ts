import { createFileRoute } from '@tanstack/react-router'

import { config } from '#devpush/server/config'
import { matchesBearerSecret } from '#devpush/server/http/auth'
import { runMaintenance } from '#devpush/server/maintenance'

export const Route = createFileRoute('/api/cron/maintenance')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!config.DEVPUSH_CRON_SECRET) {
          return Response.json(
            { error: 'Scheduled maintenance is not configured.' },
            { status: 503 },
          )
        }
        if (
          !matchesBearerSecret(
            request.headers.get('authorization'),
            config.DEVPUSH_CRON_SECRET,
          )
        ) {
          return Response.json({ error: 'Unauthorized.' }, { status: 401 })
        }

        return Response.json(await runMaintenance())
      },
    },
  },
})
