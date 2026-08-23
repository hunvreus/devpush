import { createFileRoute } from '@tanstack/react-router'

import { claimNextAgentJob } from '@/server/agents/jobs'
import {
  handleAgentRequest,
  nextAgentJobSchema,
} from '@/server/agents/protocol'

export const Route = createFileRoute('/api/agents/jobs/next')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleAgentRequest(
          request,
          nextAgentJobSchema,
          async (payload) => ({
            job: await claimNextAgentJob({
              serverId: payload.serverId,
              token: payload.token,
              protocolVersion: payload.protocolVersion,
              capabilities: payload.capabilities,
            }),
          }),
          'Unable to claim agent job.',
        )
      },
    },
  },
})
