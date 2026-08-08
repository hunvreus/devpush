import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { getRequestPublicAddress } from '@/server/http/request-ip'
import { recordAgentHeartbeat } from '@/server/servers/service'

const heartbeatSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  agentVersion: z.string().min(1).nullable().optional(),
  runtimeIds: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
  runtimes: z
    .array(
      z.object({
        runtimeId: z.string().trim().min(1).max(128),
        services: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(128),
              containerName: z.string().trim().min(1).max(256),
              state: z.string().trim().min(1).max(32),
              health: z.string().trim().max(32).nullable(),
              restartCount: z.number().int().min(0),
              startedAt: z.string().datetime().nullable(),
              exitCode: z.number().int(),
            }),
          )
          .max(500),
      }),
    )
    .max(200)
    .optional(),
  system: z
    .object({
      hostname: z.string().trim().min(1).max(255).optional(),
      operatingSystem: z.string().trim().min(1).max(255).optional(),
      kernelVersion: z.string().trim().min(1).max(255).optional(),
      architecture: z.string().trim().min(1).max(64).optional(),
      cpuCoreCount: z.number().int().min(1).max(4096).optional(),
      uptimeSeconds: z.number().int().min(0).optional(),
    })
    .optional(),
  metrics: z
    .object({
      cpuPercent: z.number().min(0).max(100).optional(),
      memoryUsedBytes: z.number().int().min(0).optional(),
      memoryTotalBytes: z.number().int().min(0).optional(),
      diskUsedBytes: z.number().int().min(0).optional(),
      diskTotalBytes: z.number().int().min(0).optional(),
      networkReceiveBytesPerSecond: z.number().min(0).optional(),
      networkTransmitBytesPerSecond: z.number().min(0).optional(),
      diskReadBytesPerSecond: z.number().min(0).optional(),
      diskWriteBytesPerSecond: z.number().min(0).optional(),
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
            runtimes: payload.runtimes,
            system: payload.system,
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
