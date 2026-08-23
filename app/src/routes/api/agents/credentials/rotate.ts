import { createFileRoute } from '@tanstack/react-router'

import { rotateAgentCredential } from '@/server/servers/service'
import {
  handleAgentRequest,
  rotateAgentCredentialSchema,
} from '@/server/agents/protocol'

export const Route = createFileRoute('/api/agents/credentials/rotate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleAgentRequest(
          request,
          rotateAgentCredentialSchema,
          rotateAgentCredential,
          'Unable to rotate agent credential.',
        )
      },
    },
  },
})
