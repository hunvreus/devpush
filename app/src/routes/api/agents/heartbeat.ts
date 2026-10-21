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
              routingAddress: payload.routingAddress,
              publicIpv4: payload.publicIpv4,
              publicIpv6: payload.publicIpv6,
              runtimeIds: payload.runtimeIds,
              runtimes: payload.runtimes,
              system: payload.system,
              metricSamples: payload.metricSamples,
            }),
          'Unable to record agent heartbeat.',
        )
      },
    },
  },
})
