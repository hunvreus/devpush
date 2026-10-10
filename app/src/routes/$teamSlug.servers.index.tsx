import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { TeamServers } from '@/features/servers/team-servers'
import { TeamServersPending } from '@/features/teams/team-route-pending'
import {
  teamSectionQueryOptions,
  teamShellQueryOptions,
} from '@/lib/team-context-query'

export const Route = createFileRoute('/$teamSlug/servers/')({
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery(
      teamSectionQueryOptions({
        section: 'servers',
        teamSlug: params.teamSlug,
      }),
    ),
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: TeamServersPending,
  component: TeamServersRoute,
})

function TeamServersRoute() {
  const params = Route.useParams()
  const { data: shell } = useSuspenseQuery(
    teamShellQueryOptions({ teamSlug: params.teamSlug }),
  )
  const { data: section } = useSuspenseQuery(
    teamSectionQueryOptions({
      section: 'servers',
      teamSlug: params.teamSlug,
    }),
  )

  if (section.section !== 'servers') {
    throw new Error('Server installation context is unavailable.')
  }

  return (
    <TeamServers
      team={shell.team}
      servers={section.servers}
      serverInstall={section.serverInstall}
    />
  )
}
