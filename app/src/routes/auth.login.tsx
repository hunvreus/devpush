import { createFileRoute, redirect } from '@tanstack/react-router'

import { LoginForm } from '@/features/auth/login-form'
import { getLoginContext } from '@/server/auth/context'

export const Route = createFileRoute('/auth/login')({
  loader: async () => {
    const { authMethods, userContext } = await getLoginContext()

    if (userContext) {
      throw redirect({
        to: '/$teamSlug',
        params: { teamSlug: userContext.defaultTeam.slug },
      })
    }

    return { authMethods }
  },
  component: LoginRoute,
})

function LoginRoute() {
  const { authMethods } = Route.useLoaderData()

  return <LoginForm authMethods={authMethods} />
}
