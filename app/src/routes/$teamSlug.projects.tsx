import { pageHead } from '#devpush/lib/page-head'
import {
  Outlet,
  createFileRoute,
  useChildMatches,
} from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'

import { TeamProjects } from '#devpush/features/teams/team-home'
import { teamShellQueryOptions } from '#devpush/lib/team-context-query'

export const Route = createFileRoute('/$teamSlug/projects')({
  loader: ({ context, location, params }) => {
    if (location.pathname !== `/${params.teamSlug}/projects`) return

    return context.queryClient.fetchQuery(
      teamShellQueryOptions({ teamSlug: params.teamSlug }),
    )
  },
  component: TeamProjectsRoute,
  head: ({ params }) => pageHead('Projects', params.teamSlug),
})

function TeamProjectsRoute() {
  const hasChild = useChildMatches({ select: (matches) => matches.length > 0 })
  if (hasChild) {
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
