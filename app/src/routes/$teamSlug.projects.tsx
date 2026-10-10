import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'

import { TeamProjects } from '@/features/teams/team-home'
import { teamShellQueryOptions } from '@/lib/team-context-query'

export const Route = createFileRoute('/$teamSlug/projects')({
  loader: ({ context, location, params }) => {
    if (location.pathname !== `/${params.teamSlug}/projects`) return

    return context.queryClient.fetchQuery(
      teamShellQueryOptions({ teamSlug: params.teamSlug }),
    )
  },
  component: TeamProjectsRoute,
})

function TeamProjectsRoute() {
  const params = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  if (pathname !== `/${params.teamSlug}/projects`) {
    return <Outlet />
  }

  return <TeamProjectsContent />
}

function TeamProjectsContent() {
  const params = Route.useParams()
  const { data: context } = useSuspenseQuery(
    teamShellQueryOptions({ teamSlug: params.teamSlug }),
  )

  return <TeamProjects team={context.team} projects={context.projects} />
}
