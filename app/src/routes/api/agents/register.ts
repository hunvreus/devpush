import { createFileRoute } from '@tanstack/react-router'

import { getRequestPublicAddress } from '@/server/http/request-ip'
import {
  handleAgentRequest,
  registerAgentSchema,
} from '@/server/agents/protocol'
import { registerAgent } from '@/server/servers/service'

export const Route = createFileRoute('/api/agents/register')({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
            }),
          'Unable to register agent.',
        )
      },
    },
  },
})
