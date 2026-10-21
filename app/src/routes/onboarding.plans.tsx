import { createFileRoute, redirect } from '@tanstack/react-router'
import { OnboardingPlans, hasPlanOnboarding } from '#devpush/deployment/ui'
import { getCurrentUserContext } from '@/server/auth/context'
import { onboardingDestination } from '@/lib/onboarding'
import { pageHead } from '@/lib/page-head'

export const Route = createFileRoute('/onboarding/plans')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { team?: string } => ({
    team: typeof search.team === 'string' ? search.team : undefined,
  }),
  loaderDeps: ({ search }) => ({ team: search.team }),
  loader: async ({ deps }) => {
    const context = await getCurrentUserContext()
    if (!context) throw redirect({ to: '/auth/login' })
    if (!hasPlanOnboarding()) throw redirect({ to: '/' })
    if (context.user.profileConfirmedAt === null)
      throw redirect({ to: '/onboarding' })
    const team = deps.team
      ? context.teams.find((candidate) => candidate.slug === deps.team)
      : context.defaultTeam
    if (!team || team.role !== 'owner') throw redirect({ to: '/' })
    return { team }
  },
  component: PlansRoute,
  head: () => pageHead('Choose a plan'),
})
function PlansRoute() {
  const { team: defaultTeam } = Route.useLoaderData()
  return (
    <OnboardingPlans
      teamSlug={defaultTeam.slug}
      role={defaultTeam.role}
      onContinue={() =>
        window.location.assign(
          onboardingDestination(undefined, defaultTeam.slug),
        )
      }
    />
  )
}
