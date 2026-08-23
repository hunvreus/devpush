import { createFileRoute } from '@tanstack/react-router'

import { recordDeploymentProgress } from '@/server/agents/jobs'
import {
  agentJobProgressSchema,
  handleAgentRequest,
} from '@/server/agents/protocol'

export const Route = createFileRoute('/api/agents/jobs/progress')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleAgentRequest(
          request,
          agentJobProgressSchema,
          (payload) =>
            recordDeploymentProgress({
              serverId: payload.serverId,
              token: payload.token,
              progress: {
                deploymentId: payload.deploymentId,
                logStartSeq: payload.logStartSeq,
                logs: payload.logs,
                events: payload.events,
              },
            }),
          'Unable to record deployment progress.',
        )
      },
    },
  },
})
