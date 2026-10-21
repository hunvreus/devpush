import { createFileRoute } from '@tanstack/react-router'
import {
  readOperationLogs,
  uploadOperationLogs,
  operationLogUploadSchema,
} from '@/server/logs/operations'
import { handleAgentRequest } from '@/server/agents/protocol'

export const Route = createFileRoute('/api/agents/job-logs')({
  server: {
    handlers: {
      GET: ({ request }) => readOperationLogs(request),
      POST: ({ request }) =>
        handleAgentRequest(
          request,
          operationLogUploadSchema,
          uploadOperationLogs,
          'Unable to record operation logs.',
        ),
    },
  },
})
