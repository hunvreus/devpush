import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { claimNextAgentJob } from '@/server/agents/jobs'

const nextJobSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
})

export const Route = createFileRoute('/api/agents/jobs/next')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = nextJobSchema.parse(await request.json())
          const job = await claimNextAgentJob(payload)

          return Response.json({ job })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to claim deployment job.',
            },
            { status: 401 },
          )
        }
      },
    },
  },
})
