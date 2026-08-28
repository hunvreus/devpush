import { createFileRoute } from '@tanstack/react-router'

import {
  getAppInstallation,
  upsertGitHubInstallation,
} from '@/server/github/service'
import { getSafeRedirectPath } from '@/server/http/internal-redirect'

export const Route = createFileRoute('/api/github/install/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const next = getSafeRedirectPath(url.searchParams.get('state'))
        const setupAction = url.searchParams.get('setup_action')
        const installationId = Number(url.searchParams.get('installation_id'))

        if (
          !Number.isSafeInteger(installationId) ||
          !['install', 'update'].includes(setupAction ?? '')
        ) {
          return Response.redirect(new URL(next, url.origin), 302)
        }

        const installation = await getAppInstallation(installationId)
        await upsertGitHubInstallation(installation)

        return Response.redirect(new URL(next, url.origin), 302)
      },
    },
  },
})
