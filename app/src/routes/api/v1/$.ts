import { createFileRoute } from '@tanstack/react-router'
import { handlePublicApiRequest } from '@/server/api/handler'

export const Route = createFileRoute('/api/v1/$')({
  server: {
    handlers: {
      GET: ({ request }) => handlePublicApiRequest(request),
      POST: ({ request }) => handlePublicApiRequest(request),
      PATCH: ({ request }) => handlePublicApiRequest(request),
      PUT: ({ request }) => handlePublicApiRequest(request),
      DELETE: ({ request }) => handlePublicApiRequest(request),
      OPTIONS: ({ request }) => handlePublicApiRequest(request),
    },
  },
})
