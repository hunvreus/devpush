import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

import { TeamProjects } from '@/features/teams/team-home'
import { TeamPage } from '@/features/teams/team-header'
import { getTeamHomeContext } from '@/server/auth/context'

export const Route = createFileRoute('/$teamSlug/projects')({
  loader: async ({ params }) => {
    const context = await getTeamHomeContext({
      data: { teamSlug: params.teamSlug },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  component: TeamProjectsRoute,
})

function TeamProjectsRoute() {
  const params = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const context = Route.useLoaderData()

  if (pathname !== `/${params.teamSlug}/projects`) {
    return <Outlet />
  }

  return (
    <TeamPage
      userContext={context.userContext}
      currentTeam={context.team}
      servers={context.servers}
      contentClassName="space-y-8"
    >
      <TeamProjects team={context.team} projects={context.projects} />
    </TeamPage>
  )
}
