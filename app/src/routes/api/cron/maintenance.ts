import { createFileRoute } from '@tanstack/react-router'

import { config } from '@/server/config'
import { cleanupExpiredTeamInvites } from '@/server/teams/service'
import { runQueuedUserCleanupJobs } from '@/server/users/service'

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

        const [invites, users] = await Promise.all([
          cleanupExpiredTeamInvites(),
          runQueuedUserCleanupJobs(),
        ])
        return Response.json({
          expiredInvites: invites.expiredCount,
          userCleanupJobs: users,
        })
      },
    },
  },
})
