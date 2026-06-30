import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { recordDeploymentProgress } from '@/server/agents/jobs'

const eventSchema = z.object({
  phase: z.enum([
    'agent_connected',
    'config_synced',
    'repo_fetched',
    'compose_resolved',
    'images_built_or_pulled',
    'release_command_started',
    'release_command_succeeded',
    'revision_started',
    'readiness_check_started',
    'traffic_switched',
    'old_revision_retired',
    'completed',
  ]),
  message: z.string().min(1),
})

const progressJobSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  deploymentId: z.string().min(1),
  logStartSeq: z.number().int().positive(),
  logs: z.array(z.string()),
  events: z.array(eventSchema),
})

export const Route = createFileRoute('/api/agents/jobs/progress')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = progressJobSchema.parse(await request.json())
          const result = await recordDeploymentProgress({
            serverId: payload.serverId,
            token: payload.token,
            progress: {
              deploymentId: payload.deploymentId,
              logStartSeq: payload.logStartSeq,
              logs: payload.logs,
              events: payload.events,
            },
          })

          return Response.json(result)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to record deployment progress.',
            },
            { status: 401 },
          )
        }
      },
    },
  },
})
