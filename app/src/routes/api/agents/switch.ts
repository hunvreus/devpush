import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { handleAgentRequest } from '#devpush/server/agents/protocol'
import { switchServerControlPlane } from '#devpush/server/servers/switch'

const schema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  action: z.enum(['prepare', 'rollback']),
  ticket: z.string().optional(),
})

export const Route = createFileRoute('/api/agents/switch')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleAgentRequest(
          request,
          schema,
          switchServerControlPlane,
          'Unable to switch control plane.',
        ),
    },
  },
})
