import { pageHead } from '#devpush/lib/page-head'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { LoginForm, LoginPending } from '#devpush/features/auth/login-form'
import { getLoginContext } from '#devpush/server/auth/context'
import { getSafeRedirectPath } from '#devpush/lib/internal-redirect'

export const Route = createFileRoute('/auth/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string'
      ? { redirect: getSafeRedirectPath(search.redirect) }
      : {},
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: async ({ deps }) => {
    const { authMethods, userContext, signInMessage } = await getLoginContext()

    if (userContext) {
      if (userContext.user.profileConfirmedAt === null)
        throw redirect({
          to: '/onboarding',
          search: { redirect: deps.redirect },
        })
      if (deps.redirect && deps.redirect !== '/') {
        throw redirect({ href: deps.redirect })
      }
      throw redirect({
        to: '/$teamSlug',
        params: { teamSlug: userContext.defaultTeam.slug },
      })
    }

    return { authMethods, signInMessage }
  },
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: LoginPending,
  component: LoginRoute,
  head: () => pageHead('Log in'),
})

function LoginRoute() {
  const { authMethods, signInMessage } = Route.useLoaderData()
  const { redirect: redirectPath } = Route.useSearch()

  return (
    <LoginForm
      authMethods={authMethods}
      redirectPath={redirectPath ?? '/'}
      signInMessage={signInMessage}
    />
  )
}
