import { createFileRoute } from '@tanstack/react-router'

import { config } from '@/server/config'
import { runMaintenance } from '@/server/maintenance'

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
          request.headers.get('authorization') !==
          `Bearer ${config.DEVPUSH_CRON_SECRET}`
        ) {
          return Response.json({ error: 'Unauthorized.' }, { status: 401 })
        }

        return Response.json(await runMaintenance())
      },
    },
  },
})
