import { createFileRoute } from '@tanstack/react-router'
import { handleMcpRequest } from '@/server/mcp/handler'

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRequest(request),
      POST: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
      OPTIONS: ({ request }) => handleMcpRequest(request),
    },
  },
})
