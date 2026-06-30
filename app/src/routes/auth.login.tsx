import { createFileRoute, redirect } from '@tanstack/react-router'

import { LoginForm } from '@/features/auth/login-form'
import { getAuthMethods } from '@/lib/auth/config'
import { getCurrentUserContext } from '@/server/auth/context'

export const Route = createFileRoute('/auth/login')({
  loader: async () => {
    const context = await getCurrentUserContext()

    if (context) {
      throw redirect({
        to: '/$teamSlug',
        params: { teamSlug: context.defaultTeam.slug },
      })
    }

    return { authMethods: getAuthMethods() }
  },
  component: LoginRoute,
})

function LoginRoute() {
  const { authMethods } = Route.useLoaderData()

  return <LoginForm authMethods={authMethods} />
}
