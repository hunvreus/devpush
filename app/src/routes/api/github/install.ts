import { createFileRoute } from '@tanstack/react-router'

import { auth } from '@/lib/auth'
import { config } from '@/server/config'

export const Route = createFileRoute('/api/github/install')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const next = getSafeNextPath(url.searchParams.get('next'))
        const session = await auth.api.getSession({
          headers: request.headers,
        })

        if (!session) {
          const loginUrl = new URL('/auth/login', url.origin)
          loginUrl.searchParams.set('redirect', next)

          return Response.redirect(loginUrl, 302)
        }

        if (!config.GITHUB_APP_NAME) {
          return Response.redirect(new URL(next, url.origin), 302)
        }

        const installUrl = new URL(
          `https://github.com/apps/${config.GITHUB_APP_NAME}/installations/new`,
        )
        installUrl.searchParams.set('state', next)

        return Response.redirect(installUrl, 302)
      },
    },
  },
})

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/'
  }

  return value
}
