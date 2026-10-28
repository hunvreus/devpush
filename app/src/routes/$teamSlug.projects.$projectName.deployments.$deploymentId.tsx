import { pageHead } from '#devpush/lib/page-head'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { DeploymentDetail } from '#devpush/features/deployments/deployment-detail'
import { ProjectSectionPending } from '#devpush/features/projects/project-route-pending'
import { pluginContextQueryOptions } from '#devpush/lib/project-context-query'

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/deployments/$deploymentId',
)({
  validateSearch: (
    search: Record<string, unknown>,
  ): { unavailable?: boolean } => ({
    unavailable: search.unavailable === true || search.unavailable === 'true',
  }),
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery(
      pluginContextQueryOptions(
        {
          teamSlug: params.teamSlug,
          projectName: params.projectName,
          deploymentId: params.deploymentId,
        },
        context.queryClient,
      ),
    ),
  pendingMs: 0,
  pendingComponent: DeploymentPending,
  component: DeploymentRoute,
  head: ({ params }) =>
    pageHead(
      `Deployment ${params.deploymentId}`,
      params.projectName,
      params.teamSlug,
    ),
})

function DeploymentPending() {
  return <ProjectSectionPending section="deployment" />
}

function DeploymentRoute() {
  const params = Route.useParams()
  const queryClient = useQueryClient()
  const { data: context } = useSuspenseQuery(
    pluginContextQueryOptions(params, queryClient),
  )

  const { unavailable } = Route.useSearch()
  return <DeploymentDetail context={context} unavailable={unavailable} />
}
