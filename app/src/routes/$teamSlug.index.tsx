import { pageHead } from '#devpush/lib/page-head'
import { useRefreshError } from '#devpush/lib/use-refresh-error'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { TeamHome } from '#devpush/features/teams/team-home'
import { TeamOverviewPending } from '#devpush/features/teams/team-route-pending'
import {
  teamSectionQueryOptions,
  teamShellQueryOptions,
} from '#devpush/lib/team-context-query'

export const Route = createFileRoute('/$teamSlug/')({
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery(
      teamSectionQueryOptions({
        section: 'overview',
        teamSlug: params.teamSlug,
      }),
    ),
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: TeamOverviewPending,
  component: TeamHomeRoute,
  head: ({ params }) => pageHead('Overview', params.teamSlug),
})

function TeamHomeRoute() {
  const params = Route.useParams()
  const { data: shell } = useSuspenseQuery(
    teamShellQueryOptions({ teamSlug: params.teamSlug }),
  )
  const { data: section, error } = useSuspenseQuery(
    teamSectionQueryOptions({
      section: 'overview',
      teamSlug: params.teamSlug,
    }),
  )

  useRefreshError(error, 'team-deployments-refresh')

  if (section.section !== 'overview') {
    throw new Error('Team overview context is unavailable.')
  }

  return (
    <TeamHome
      team={shell.team}
      deployments={section.deployments}
      projects={shell.projects}
      servers={shell.servers}
    />
  )
}
