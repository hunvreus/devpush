import { createFileRoute } from '@tanstack/react-router'
import { handlePluginRequest } from '#devpush/server/http/plugin-request'

export const Route = createFileRoute('/api/plugins/$')({
  server: {
    handlers: {
      GET: ({ request }) => handlePluginRequest(request),
      POST: ({ request }) => handlePluginRequest(request),
    },
  },
})
