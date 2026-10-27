import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  WorkspaceOnboarding,
  hasWorkspaceOnboarding,
} from '#devpush/features/plugins/contributions'
import { getCurrentUserContext } from '#devpush/server/auth/context'
import { onboardingDestination } from '#devpush/lib/onboarding'
import { pageHead } from '#devpush/lib/page-head'

export const Route = createFileRoute('/onboarding/workspace')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { team?: string } => ({
    team: typeof search.team === 'string' ? search.team : undefined,
  }),
  loaderDeps: ({ search }) => ({ team: search.team }),
  loader: async ({ deps }) => {
    const context = await getCurrentUserContext()
    if (!context) throw redirect({ to: '/auth/login' })
    if (!hasWorkspaceOnboarding()) throw redirect({ to: '/' })
    if (context.user.profileConfirmedAt === null)
      throw redirect({ to: '/onboarding' })
    const team = deps.team
      ? context.teams.find((candidate) => candidate.slug === deps.team)
      : context.defaultTeam
    if (!team || team.role !== 'owner') throw redirect({ to: '/' })
    return { team }
  },
  component: WorkspaceOnboardingRoute,
  head: () => pageHead('Set up workspace'),
})
function WorkspaceOnboardingRoute() {
  const { team: defaultTeam } = Route.useLoaderData()
  return (
    <WorkspaceOnboarding
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
