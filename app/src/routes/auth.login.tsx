import { createFileRoute, redirect } from '@tanstack/react-router'

import { LoginForm, LoginPending } from '@/features/auth/login-form'
import { getLoginContext } from '@/server/auth/context'
import { getSafeRedirectPath } from '@/server/http/internal-redirect'

export const Route = createFileRoute('/auth/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string'
      ? { redirect: getSafeRedirectPath(search.redirect) }
      : {},
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: async ({ deps }) => {
    const { authMethods, userContext } = await getLoginContext()

    if (userContext) {
      if (deps.redirect && deps.redirect !== '/') {
        throw redirect({ href: deps.redirect })
      }
      throw redirect({
        to: '/$teamSlug',
        params: { teamSlug: userContext.defaultTeam.slug },
      })
    }

    return { authMethods }
  },
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: LoginPending,
  component: LoginRoute,
})

function LoginRoute() {
  const { authMethods } = Route.useLoaderData()
  const { redirect: redirectPath } = Route.useSearch()

  return (
    <LoginForm authMethods={authMethods} redirectPath={redirectPath ?? '/'} />
  )
}
