import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

import { TeamHome } from '@/features/teams/team-home'
import { TeamPage } from '@/features/teams/team-header'
import { getTeamHomeContext } from '@/server/auth/context'

export const Route = createFileRoute('/$teamSlug')({
  loader: async ({ params }) => {
    const context = await getTeamHomeContext({
      data: { teamSlug: params.teamSlug },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  component: TeamHomeRoute,
})

function TeamHomeRoute() {
  const params = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const context = Route.useLoaderData()

  if (pathname !== `/${params.teamSlug}`) {
    return <Outlet />
  }

  return (
    <TeamPage
      userContext={context.userContext}
      currentTeam={context.team}
      servers={context.servers}
      contentClassName="space-y-8"
    >
      <TeamHome
        team={context.team}
        deployments={context.deployments}
        projects={context.projects}
        servers={context.servers}
      />
    </TeamPage>
  )
}
