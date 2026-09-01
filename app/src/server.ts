import handler from '@tanstack/react-start/server-entry'

import { config } from '@/server/config'
import { queueDueBackupSchedules } from '@/server/backups/service'
import { withDatabaseScope } from '@/server/db'
import { cleanupExpiredTeamInvites } from '@/server/teams/service'
import { runQueuedUserCleanupJobs } from '@/server/users/service'

export default {
  fetch(request) {
    return withDatabaseScope(() => handler.fetch(request))
  },

  async scheduled(controller, _env, context) {
    context.waitUntil(
      withDatabaseScope(async () => {
        const tasks: Array<Promise<unknown>> = []

        if (config.DEVPUSH_BACKUPS_ENABLED) {
          tasks.push(queueDueBackupSchedules())
        }

        const scheduledAt = new Date(controller.scheduledTime)
        if (scheduledAt.getUTCMinutes() === 0) {
          tasks.push(
            Promise.all([
              cleanupExpiredTeamInvites(),
              runQueuedUserCleanupJobs(),
            ]),
          )
        }

        await Promise.all(tasks)
      }),
    )
  },
} satisfies ExportedHandler<Env>
