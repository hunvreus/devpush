import { pageHead } from '@/lib/page-head'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { TeamServers } from '@/features/servers/team-servers'
import { TeamServersPending } from '@/features/teams/team-route-pending'
import {
  teamSectionQueryOptions,
  teamShellQueryOptions,
} from '@/lib/team-context-query'

export const Route = createFileRoute('/$teamSlug/servers/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { addServer?: boolean } => ({
    addServer:
      search.addServer === '1' ||
      search.addServer === 1 ||
      search.addServer === true,
  }),
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
  head: ({ params }) => pageHead('Servers', params.teamSlug),
})

function TeamServersRoute() {
  const params = Route.useParams()
  const search = Route.useSearch()
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
      initialAddServerOpen={search.addServer}
      team={shell.team}
      servers={section.servers}
      serverInstall={section.serverInstall}
    />
  )
}
