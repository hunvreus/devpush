import { createFileRoute } from '@tanstack/react-router'

import { completeAgentJob } from '@/server/agents/completion'
import {
  completeAgentJobSchema,
  handleAgentRequest,
} from '@/server/agents/protocol'

export const Route = createFileRoute('/api/agents/jobs/complete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleAgentRequest(
          request,
          completeAgentJobSchema,
          completeAgentJob,
          'Unable to complete agent job.',
        )
      },
    },
  },
})
