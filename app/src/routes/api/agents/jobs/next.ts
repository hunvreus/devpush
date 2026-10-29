import { createFileRoute } from '@tanstack/react-router'

import { claimNextAgentJob } from '#devpush/server/agents/jobs'
import { waitForAgentJob } from '#devpush/server/agents/job-wait'
import {
  handleAgentRequest,
  nextAgentJobSchema,
} from '#devpush/server/agents/protocol'

export const Route = createFileRoute('/api/agents/jobs/next')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleAgentRequest(
          request,
          nextAgentJobSchema,
          async (payload) => ({
            job: await waitForAgentJob(
              () =>
                claimNextAgentJob({
                  serverId: payload.serverId,
                  token: payload.token,
                  protocolVersion: payload.protocolVersion,
                  capabilities: payload.capabilities,
                }),
              payload.waitSeconds,
              request.signal,
            ),
          }),
          'Unable to claim agent job.',
        )
      },
    },
  },
})
