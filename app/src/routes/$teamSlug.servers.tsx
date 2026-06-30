import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

import { TeamServers } from '@/features/servers/team-servers'
import { TeamPage } from '@/features/teams/team-header'
import { getTeamHomeContext } from '@/server/auth/context'

export const Route = createFileRoute('/$teamSlug/servers')({
  loader: async ({ params }) => {
    const context = await getTeamHomeContext({
      data: { teamSlug: params.teamSlug },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  component: TeamServersRoute,
})

function TeamServersRoute() {
  const context = Route.useLoaderData()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isIndexRoute = pathname === `/${context.team.slug}/servers`

  return (
    <TeamPage
      userContext={context.userContext}
      currentTeam={context.team}
      servers={context.servers}
      contentClassName="space-y-8"
    >
      {isIndexRoute ? (
        <TeamServers
          team={context.team}
          servers={context.servers}
          serverInstall={context.serverInstall}
        />
      ) : (
        <Outlet />
      )}
    </TeamPage>
  )
}
