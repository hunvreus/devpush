import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { getRequestPublicAddress } from '@/server/http/request-ip'
import { recordAgentHeartbeat } from '@/server/servers/service'

const heartbeatSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  agentVersion: z.string().min(1).nullable().optional(),
  runtimeIds: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
  metrics: z
    .object({
      cpuPercent: z.number().min(0).max(100).optional(),
      load1: z.number().min(0).optional(),
      memoryUsedBytes: z.number().int().min(0).optional(),
      memoryTotalBytes: z.number().int().min(0).optional(),
      diskUsedBytes: z.number().int().min(0).optional(),
      diskTotalBytes: z.number().int().min(0).optional(),
    })
    .optional(),
})

export const Route = createFileRoute('/api/agents/heartbeat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = heartbeatSchema.parse(await request.json())
          const heartbeat = await recordAgentHeartbeat({
            serverId: payload.serverId,
            token: payload.token,
            agentVersion: payload.agentVersion ?? null,
            publicAddress: getRequestPublicAddress(request),
            runtimeIds: payload.runtimeIds,
            metrics: payload.metrics,
          })

          return Response.json(heartbeat)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to record agent heartbeat.',
            },
            { status: 401 },
          )
        }
      },
    },
  },
})
