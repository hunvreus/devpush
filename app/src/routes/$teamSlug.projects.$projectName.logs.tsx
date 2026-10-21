import { pageHead } from '@/lib/page-head'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { ProjectLogs } from '@/features/projects/project-logs'
import { ProjectSectionPending } from '@/features/projects/project-route-pending'
import { stringSearchValidator } from '@/lib/search'
import { projectLogsQueryOptions } from '@/lib/project-context-query'

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
  loader: ({ context, params, deps }) =>
    context.queryClient.fetchQuery(
      projectLogsQueryOptions(
        {
          teamSlug: params.teamSlug,
          projectName: params.projectName,
          branch: deps.branch,
          date: deps.date,
          deploymentId: deps.deploymentId,
          environmentId: deps.environmentId,
          keyword: deps.keyword,
        },
        context.queryClient,
      ),
    ),
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: LogsPending,
  component: LogsRoute,
  head: ({ params }) => pageHead('Logs', params.projectName, params.teamSlug),
})

function LogsPending() {
  return <ProjectSectionPending section="logs" />
}

function LogsRoute() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const queryClient = useQueryClient()
  const { data: context } = useSuspenseQuery(
    projectLogsQueryOptions({ ...params, ...search }, queryClient),
  )

  return <ProjectLogs context={context} />
}
