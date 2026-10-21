import { getCurrentUserContext } from '@/server/auth/context'
import { pageHead } from '@/lib/page-head'
import { useWorkspaceUpdates } from '@/features/teams/use-workspace-updates'
import {
  Outlet,
  redirect,
  createFileRoute,
  useParams,
  useRouterState,
} from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'

import { TeamPage } from '@/features/teams/team-header'
import { TeamLayoutPending } from '@/features/teams/team-route-pending'
import { teamShellQueryOptions } from '@/lib/team-context-query'

export const Route = createFileRoute('/$teamSlug')({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const context = await getCurrentUserContext()
    if (context?.user.profileConfirmedAt === null)
      throw redirect({ to: '/onboarding', search: { redirect: location.href } })
  },
  loader: ({ context, location, params }) => {
    if (isProjectRoute(location.pathname, params.teamSlug)) {
      return
    }

    return context.queryClient.fetchQuery(
      teamShellQueryOptions({ teamSlug: params.teamSlug }),
    )
  },
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: TeamLayoutPending,
  component: TeamLayoutRoute,
  head: ({ params }) => pageHead('Overview', params.teamSlug),
})

function TeamLayoutRoute() {
  const params = useParams({ strict: false })
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const teamSlug = String(params.teamSlug)
  useWorkspaceUpdates(teamSlug)

  if (isProjectRoute(pathname, teamSlug)) {
    return <Outlet />
  }

  return <TeamLayoutContent teamSlug={teamSlug} />
}

function TeamLayoutContent({ teamSlug }: { teamSlug: string }) {
  const params = useParams({ strict: false })
  const { data: context } = useSuspenseQuery(
    teamShellQueryOptions({ teamSlug }),
  )

  const project =
    typeof params.projectName === 'string'
      ? context.projects.find((item) => item.name === params.projectName)
      : undefined

  return (
    <TeamPage
      userContext={context.userContext}
      currentTeam={context.team}
      currentProject={project}
      currentProjects={context.projects}
      servers={context.servers}
      contentClassName="space-y-8"
    >
      <Outlet />
    </TeamPage>
  )
}

function isProjectRoute(pathname: string, teamSlug: string) {
  return pathname.startsWith(`/${teamSlug}/projects/`)
}
