import { createFileRoute } from '@tanstack/react-router'

import { config } from '@/server/config'
import { queueDueBackupSchedules } from '@/server/backups/service'

export const Route = createFileRoute('/api/cron/backups')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!config.DEVPUSH_BACKUPS_ENABLED) {
          return Response.json({ error: 'Not found.' }, { status: 404 })
        }

        const authorization = request.headers.get('authorization')
        const expected = `Bearer ${config.DEVPUSH_CRON_SECRET}`

        if (authorization !== expected) {
          return Response.json({ error: 'Unauthorized.' }, { status: 401 })
        }

        const queued = await queueDueBackupSchedules()

        return Response.json({ queued })
      },
    },
  },
})
