import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { DeploymentDetail } from '@/features/deployments/deployment-detail'
import { ProjectSectionPending } from '@/features/projects/project-route-pending'
import { deploymentContextQueryOptions } from '@/lib/project-context-query'

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/deployments/$deploymentId',
)({
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery(
      deploymentContextQueryOptions(
        {
          teamSlug: params.teamSlug,
          projectName: params.projectName,
          deploymentId: params.deploymentId,
        },
        context.queryClient,
      ),
    ),
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: DeploymentPending,
  component: DeploymentRoute,
})

function DeploymentPending() {
  return <ProjectSectionPending section="deployment" />
}

function DeploymentRoute() {
  const params = Route.useParams()
  const queryClient = useQueryClient()
  const { data: context } = useSuspenseQuery(
    deploymentContextQueryOptions(params, queryClient),
  )

  return <DeploymentDetail context={context} />
}
