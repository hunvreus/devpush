import { createFileRoute } from '@tanstack/react-router'

import { getDeploymentJobStatus } from '@/server/agents/jobs'
import {
  agentJobStatusSchema,
  handleAgentRequest,
} from '@/server/agents/protocol'

export const Route = createFileRoute('/api/agents/jobs/status')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleAgentRequest(
          request,
          agentJobStatusSchema,
          getDeploymentJobStatus,
          'Unable to read deployment job status.',
        )
      },
    },
  },
})
