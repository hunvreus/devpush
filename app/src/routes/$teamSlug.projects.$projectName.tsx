import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

import { ProjectLayout } from '@/features/projects/project-layout'
import { ProjectOverview } from '@/features/projects/project-overview'
import { getProject } from '@/server/projects/functions'

export const Route = createFileRoute('/$teamSlug/projects/$projectName')({
  loader: async ({ params }) => {
    const context = await getProject({
      data: {
        teamSlug: params.teamSlug,
        projectName: params.projectName,
      },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  component: ProjectRoute,
})

function ProjectRoute() {
  const params = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const context = Route.useLoaderData()

  if (pathname !== `/${params.teamSlug}/projects/${params.projectName}`) {
    return <Outlet />
  }

  return (
    <ProjectLayout context={context} contentClassName="space-y-8">
      <ProjectOverview context={context} />
    </ProjectLayout>
  )
}
