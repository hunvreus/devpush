import { createFileRoute } from '@tanstack/react-router'
import { handleDeploymentRequest } from '@/server/http/deployment-request'

export const Route = createFileRoute('/api/deployment/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleDeploymentRequest(request),
      POST: ({ request }) => handleDeploymentRequest(request),
    },
  },
})
