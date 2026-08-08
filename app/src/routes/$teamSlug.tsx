import {
  Outlet,
  createFileRoute,
  redirect,
  useParams,
  useRouter,
} from '@tanstack/react-router'

import { TeamPage } from '@/features/teams/team-header'
import { useVisibleRefresh } from '@/lib/use-visible-refresh'
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
  component: TeamLayoutRoute,
})

function TeamLayoutRoute() {
  const router = useRouter()
  const params = useParams({ strict: false })
  const context = Route.useLoaderData()
  const project =
    typeof params.projectName === 'string'
      ? context.projects.find((item) => item.name === params.projectName)
      : undefined

  useVisibleRefresh(() => router.invalidate())

  return (
    <TeamPage
      userContext={context.userContext}
      currentTeam={context.team}
      currentProject={project}
      currentProjects={context.projects}
      servers={context.servers}
      contentClassName="space-y-8"
    >
      <Outlet />
    </TeamPage>
  )
}
