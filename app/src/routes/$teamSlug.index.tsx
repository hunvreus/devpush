import { createFileRoute, getRouteApi } from '@tanstack/react-router'

import { TeamHome } from '@/features/teams/team-home'

const teamRoute = getRouteApi('/$teamSlug')

export const Route = createFileRoute('/$teamSlug/')({
  component: TeamHomeRoute,
})

function TeamHomeRoute() {
  const context = teamRoute.useLoaderData()

  return (
    <TeamHome
      team={context.team}
      deployments={context.deployments}
      projects={context.projects}
      servers={context.servers}
    />
  )
}
