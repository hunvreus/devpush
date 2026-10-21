import { createFileRoute } from '@tanstack/react-router'

import { config } from '@/server/config'
import { matchesBearerSecret } from '@/server/http/auth'
import { queueDueBackupSchedules } from '@/server/backups/service'

export const Route = createFileRoute('/api/cron/backups')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!config.DEVPUSH_BACKUPS_ENABLED) {
          return Response.json({ error: 'Not found.' }, { status: 404 })
        }

        if (!config.DEVPUSH_CRON_SECRET) {
          return Response.json(
            { error: 'Scheduled backups are not configured.' },
            { status: 503 },
          )
        }

        const authorization = request.headers.get('authorization')
        if (!matchesBearerSecret(authorization, config.DEVPUSH_CRON_SECRET)) {
          return Response.json({ error: 'Unauthorized.' }, { status: 401 })
        }

        const queued = await queueDueBackupSchedules()

        return Response.json({ queued })
      },
    },
  },
})
