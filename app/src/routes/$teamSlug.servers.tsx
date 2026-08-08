import {
  createFileRoute,
  getRouteApi,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'

import { TeamServers } from '@/features/servers/team-servers'

const teamRoute = getRouteApi('/$teamSlug')

export const Route = createFileRoute('/$teamSlug/servers')({
  component: TeamServersRoute,
})

function TeamServersRoute() {
  const context = teamRoute.useLoaderData()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isIndexRoute = pathname === `/${context.team.slug}/servers`

  return isIndexRoute ? (
    <TeamServers
      team={context.team}
      servers={context.servers}
      serverInstall={context.serverInstall}
    />
  ) : (
    <Outlet />
  )
}
