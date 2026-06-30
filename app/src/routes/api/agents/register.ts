import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { getRequestPublicAddress } from '@/server/http/request-ip'
import { registerAgent } from '@/server/servers/service'

const registerSchema = z.object({
  token: z.string().min(1),
  agentVersion: z.string().min(1).nullable().optional(),
})

export const Route = createFileRoute('/api/agents/register')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = registerSchema.parse(await request.json())
          const registration = await registerAgent({
            token: payload.token,
            agentVersion: payload.agentVersion ?? null,
            publicAddress: getRequestPublicAddress(request),
          })

          return Response.json(registration)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to register agent.',
            },
            { status: 401 },
          )
        }
      },
    },
  },
})
