import { createFileRoute, redirect } from '@tanstack/react-router'

import { ProjectLogs } from '@/features/projects/project-logs'
import { ProjectRoutePending } from '@/features/projects/project-route-pending'
import { stringSearchValidator } from '@/lib/search'
import { getProjectLogs } from '@/server/projects/functions'

const validateSearch = stringSearchValidator([
  'branch',
  'date',
  'deploymentId',
  'environmentId',
  'keyword',
] as const)

export const Route = createFileRoute('/$teamSlug/projects/$projectName/logs')({
  validateSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const context = await getProjectLogs({
      data: {
        teamSlug: params.teamSlug,
        projectName: params.projectName,
        branch: deps.branch,
        date: deps.date,
        deploymentId: deps.deploymentId,
        environmentId: deps.environmentId,
        keyword: deps.keyword,
      },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  pendingMs: 0,
  pendingMinMs: 300,
  pendingComponent: LogsPending,
  component: LogsRoute,
})

function LogsPending() {
  return <ProjectRoutePending section="logs" />
}

function LogsRoute() {
  const context = Route.useLoaderData()

  return <ProjectLogs context={context} />
}
