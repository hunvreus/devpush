import { createFileRoute } from '@tanstack/react-router'

import { getRequestPublicAddress } from '@/server/http/request-ip'
import { handleAgentRequest, heartbeatSchema } from '@/server/agents/protocol'
import { recordAgentHeartbeat } from '@/server/servers/service'

export const Route = createFileRoute('/api/agents/heartbeat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleAgentRequest(
          request,
          heartbeatSchema,
          (payload) =>
            recordAgentHeartbeat({
              serverId: payload.serverId,
              token: payload.token,
              agentVersion: payload.agentVersion,
              protocolVersion: payload.protocolVersion,
              capabilities: payload.capabilities,
              publicAddress: getRequestPublicAddress(request),
              runtimeIds: payload.runtimeIds,
              runtimes: payload.runtimes,
              system: payload.system,
              metrics: payload.metrics,
            }),
          'Unable to record agent heartbeat.',
        )
      },
    },
  },
})
