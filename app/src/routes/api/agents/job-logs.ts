import { createFileRoute } from '@tanstack/react-router'
import {
  readOperationLogs,
  uploadOperationLogs,
  operationLogUploadSchema,
} from '#devpush/server/logs/operations'
import { handleAgentRequest } from '#devpush/server/agents/protocol'

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
