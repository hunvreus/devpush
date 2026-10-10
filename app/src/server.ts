import { connectWorkspaceUpdates } from '@/server/realtime/service'
import handler from '@tanstack/react-start/server-entry'

import { assertRuntimeSecurity, config } from '@/server/config'
import { queueDueBackupSchedules } from '@/server/backups/service'
import { withDatabaseScope } from '@/server/db'
import { withSecurityHeaders } from '@/server/http/security-headers'
import { runMaintenance } from '@/server/maintenance'

export { WorkspaceUpdates } from '@/server/realtime/workspace-object'

export default {
  async fetch(request, _env, context) {
    assertRuntimeSecurity(config)
    const response = await withDatabaseScope(
      () =>
        new URL(request.url).pathname === '/api/workspaces/updates'
          ? connectWorkspaceUpdates(request)
          : handler.fetch(request),
      (promise) => context.waitUntil(promise),
    )
    return response.status === 101
      ? response
      : withSecurityHeaders(response, request)
  },

  async scheduled(controller, _env, context) {
    assertRuntimeSecurity(config)
    context.waitUntil(
      withDatabaseScope(
        async () => {
          const tasks: Array<Promise<unknown>> = []

          if (config.DEVPUSH_BACKUPS_ENABLED) {
            tasks.push(queueDueBackupSchedules())
          }

          const scheduledAt = new Date(controller.scheduledTime)
          if (scheduledAt.getUTCMinutes() === 0) {
            tasks.push(runMaintenance())
          }

          await Promise.all(tasks)
        },
        (promise) => context.waitUntil(promise),
      ),
    )
  },
} satisfies ExportedHandler<Env>
