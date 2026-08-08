import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { rotateAgentCredential } from '@/server/servers/service'

const rotateSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
})

export const Route = createFileRoute('/api/agents/credentials/rotate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = rotateSchema.parse(await request.json())
          return Response.json(await rotateAgentCredential(payload))
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to rotate agent credential.',
            },
            { status: 401 },
          )
        }
      },
    },
  },
})
