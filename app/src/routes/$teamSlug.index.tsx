import { useRefreshError } from '@/lib/use-refresh-error'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { TeamHome } from '@/features/teams/team-home'
import { TeamOverviewPending } from '@/features/teams/team-route-pending'
import {
  teamSectionQueryOptions,
  teamShellQueryOptions,
} from '@/lib/team-context-query'

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
