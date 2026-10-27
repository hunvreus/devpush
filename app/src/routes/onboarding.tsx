import {
  createFileRoute,
  redirect,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import { getCurrentUserContext } from '#devpush/server/auth/context'
import { getSafeRedirectPath } from '#devpush/lib/internal-redirect'
import { ProfileOnboarding } from '#devpush/features/onboarding/profile-onboarding'
import { pageHead } from '#devpush/lib/page-head'

export const Route = createFileRoute('/onboarding')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect:
      typeof search.redirect === 'string'
        ? getSafeRedirectPath(search.redirect)
        : undefined,
  }),
  loader: async () => {
    const context = await getCurrentUserContext()
    if (!context) throw redirect({ to: '/auth/login' })
    return context
  },
  component: OnboardingRoute,
  head: () => pageHead('Confirm your details'),
})
function OnboardingRoute() {
  const context = Route.useLoaderData()
  const search = Route.useSearch()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  return pathname === '/onboarding/workspace' ? (
    <Outlet />
  ) : (
    <ProfileOnboarding context={context} destination={search.redirect} />
  )
}
