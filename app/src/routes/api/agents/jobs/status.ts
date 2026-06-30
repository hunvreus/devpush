import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { getDeploymentJobStatus } from '@/server/agents/jobs'

const statusJobSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  deploymentId: z.string().min(1),
})

export const Route = createFileRoute('/api/agents/jobs/status')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = statusJobSchema.parse(await request.json())
          const result = await getDeploymentJobStatus(payload)

          return Response.json(result)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to read deployment job status.',
            },
            { status: 401 },
          )
        }
      },
    },
  },
})
