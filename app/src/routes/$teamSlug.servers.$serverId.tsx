import { pageHead } from '@/lib/page-head'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ServerDetail } from '@/features/servers/server-detail'
import { ServerDetailPending } from '@/features/servers/server-detail-pending'
import { serverContextQueryOptions } from '@/lib/server-context-query'

export const Route = createFileRoute('/$teamSlug/servers/$serverId')({
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery(serverContextQueryOptions(params)),
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: ServerDetailPending,
  component: TeamServerRoute,
  head: ({ loaderData, params }) =>
    pageHead(loaderData?.server.name ?? 'Server', params.teamSlug),
})

function TeamServerRoute() {
  const { data: context } = useSuspenseQuery(
    serverContextQueryOptions(Route.useParams()),
  )

  return (
    <ServerDetail
      key={context.server.id}
      team={context.team}
      server={context.server}
    />
  )
}
