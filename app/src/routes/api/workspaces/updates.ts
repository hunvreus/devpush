import { createFileRoute } from '@tanstack/react-router'
import { connectWorkspaceUpdates } from '@/server/realtime/service'

export const Route = createFileRoute('/api/workspaces/updates')({
  server: {
    handlers: { GET: ({ request }) => connectWorkspaceUpdates(request) },
  },
})
