import { createFileRoute } from '@tanstack/react-router'

import { auth } from '#devpush/server/auth/better-auth'
import {
  getAppInstallation,
  upsertGitHubInstallation,
} from '#devpush/server/github/service'
import { verifyGitHubInstallState } from '#devpush/server/github/install-state'

export const Route = createFileRoute('/api/github/install/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const session = await auth.api.getSession({ headers: request.headers })
        const state = url.searchParams.get('state')

        if (!session || !state) {
          return Response.json({ error: 'Unauthorized.' }, { status: 401 })
        }

        let next: string
        try {
          next = await verifyGitHubInstallState({
            state,
            userId: session.user.id,
          })
        } catch {
          return Response.json(
            { error: 'Invalid or expired GitHub installation state.' },
            { status: 400 },
          )
        }
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
