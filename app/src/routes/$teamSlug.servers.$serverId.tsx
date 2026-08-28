import { createFileRoute, redirect } from '@tanstack/react-router'

import { ServerDetail } from '@/features/servers/server-detail'
import { ServerDetailPending } from '@/features/servers/server-detail-pending'
import { getTeamServerContext } from '@/server/auth/context'

export const Route = createFileRoute('/$teamSlug/servers/$serverId')({
  loader: async ({ params }) => {
    const context = await getTeamServerContext({
      data: {
        teamSlug: params.teamSlug,
        serverId: params.serverId,
      },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  pendingMs: 0,
  pendingMinMs: 300,
  pendingComponent: ServerDetailPending,
  component: TeamServerRoute,
})

function TeamServerRoute() {
  const context = Route.useLoaderData()

  return <ServerDetail team={context.team} server={context.server} />
}
