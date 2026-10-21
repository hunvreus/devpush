import { createFileRoute } from '@tanstack/react-router'

import { handleGitHubWebhook } from '@/server/github/webhook-handler'

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: ({ request }) => handleGitHubWebhook(request),
    },
  },
})
