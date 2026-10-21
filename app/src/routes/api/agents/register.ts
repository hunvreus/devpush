import { createFileRoute } from '@tanstack/react-router'

import { getRequestPublicAddress } from '@/server/http/request-ip'
import {
  handleAgentRequest,
  registerAgentSchema,
} from '@/server/agents/protocol'
import { registerAgent } from '@/server/servers/service'
import { enforceRateLimit } from '@/server/http/rate-limit'

export const Route = createFileRoute('/api/agents/register')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = await enforceRateLimit({
          limit: 20,
          request,
          scope: 'agent-register',
          windowMs: 10 * 60 * 1000,
        })

        if (limited) {
          return limited
        }

        return handleAgentRequest(
          request,
          registerAgentSchema,
          (payload) =>
            registerAgent({
              token: payload.token,
              agentVersion: payload.agentVersion,
              protocolVersion: payload.protocolVersion,
              capabilities: payload.capabilities,
              publicAddress: getRequestPublicAddress(request),
              routingAddress: payload.routingAddress,
              publicIpv4: payload.publicIpv4,
              publicIpv6: payload.publicIpv6,
            }),
          'Unable to register agent.',
        )
      },
    },
  },
})
