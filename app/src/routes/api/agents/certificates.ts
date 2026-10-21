import { createFileRoute } from '@tanstack/react-router'
import { handleAgentRequest } from '@/server/agents/protocol'
import {
  certificateRequestSchema,
  requestAgentCertificate,
} from '@/server/agents/certificates'

export const Route = createFileRoute('/api/agents/certificates')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleAgentRequest(
          request,
          certificateRequestSchema,
          requestAgentCertificate,
          'Unable to request a certificate.',
          32 * 1024,
        ),
    },
  },
})
