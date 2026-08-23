import { createFileRoute } from '@tanstack/react-router'

import { recordRuntimeLogs } from '@/server/agents/runtime-logs'
import { handleAgentRequest, runtimeLogsSchema } from '@/server/agents/protocol'

export const Route = createFileRoute('/api/agents/runtime-logs')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleAgentRequest(
          request,
          runtimeLogsSchema,
          recordRuntimeLogs,
          'Unable to record runtime logs.',
        )
      },
    },
  },
})
