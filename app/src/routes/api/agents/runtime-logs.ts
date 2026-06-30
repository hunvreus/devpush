import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { recordRuntimeLogs } from '@/server/agents/runtime-logs'

const runtimeLogSchema = z.object({
  runtimeId: z.string().min(1).max(128),
  service: z.string().min(1).max(128),
  observedAt: z.string().min(1),
  content: z.string().min(1),
})

const runtimeLogsSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  logs: z.array(runtimeLogSchema).max(500),
})

export const Route = createFileRoute('/api/agents/runtime-logs')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = runtimeLogsSchema.parse(await request.json())
          const result = await recordRuntimeLogs(payload)

          return Response.json(result)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to record runtime logs.',
            },
            { status: 401 },
          )
        }
      },
    },
  },
})
