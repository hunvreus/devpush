import {
  Outlet,
  createFileRoute,
  getRouteApi,
  useRouterState,
} from '@tanstack/react-router'

import { TeamProjects } from '@/features/teams/team-home'

const teamRoute = getRouteApi('/$teamSlug')

export const Route = createFileRoute('/$teamSlug/projects')({
  component: TeamProjectsRoute,
})

function TeamProjectsRoute() {
  const params = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const context = teamRoute.useLoaderData()

  if (pathname !== `/${params.teamSlug}/projects`) {
    return <Outlet />
  }

  return <TeamProjects team={context.team} projects={context.projects} />
}
