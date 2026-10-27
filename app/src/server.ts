import { withPluginScope } from '#devpush/server/plugins/scope'
import { withBackgroundTasks } from '#devpush/server/runtime/background'
import { connectWorkspaceUpdates } from '#devpush/server/realtime/service'
import handler from '@tanstack/react-start/server-entry'

import { assertRuntimeSecurity, config } from '#devpush/server/config'
import { withDatabaseScope } from '#devpush/server/db'
import { withSecurityHeaders } from '#devpush/server/http/security-headers'
import { runScheduledTasks } from '#devpush/server/scheduled-tasks'
import { resolveProxyRequest } from '#devpush/server/http/proxy-request'

export { WorkspaceUpdates } from '#devpush/server/realtime/workspace-object'

export default {
  async fetch(request: Request, _env: Env, context?: ExecutionContext) {
    assertRuntimeSecurity(config)
    request = resolveProxyRequest(request)
    const response = await withPluginScope(() =>
      withDatabaseScope(
        () =>
          withBackgroundTasks(
            (promise) => context?.waitUntil(promise),
            () =>
              new URL(request.url).pathname === '/api/workspaces/updates'
                ? connectWorkspaceUpdates(request)
                : handler.fetch(request),
          ),
        (promise) => context?.waitUntil(promise),
      ),
    )
    return response.status === 101
      ? response
      : withSecurityHeaders(response, request)
  },

  async scheduled(controller, _env, context) {
    assertRuntimeSecurity(config)
    context.waitUntil(
      withPluginScope(() =>
        withDatabaseScope(
          async () => {
            await withBackgroundTasks(
              (promise) => context.waitUntil(promise),
              () =>
                runScheduledTasks(
                  new Date(controller.scheduledTime).getUTCMinutes() === 0,
                ),
            )
          },
          (promise) => context.waitUntil(promise),
        ),
      ),
    )
  },
} satisfies ExportedHandler<Env>
