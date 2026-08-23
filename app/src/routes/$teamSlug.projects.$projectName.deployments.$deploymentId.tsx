import { createFileRoute, redirect } from '@tanstack/react-router'

import { DeploymentDetail } from '@/features/deployments/deployment-detail'
import { ProjectRoutePending } from '@/features/projects/project-route-pending'
import { getDeployment } from '@/server/projects/functions'

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/deployments/$deploymentId',
)({
  loader: async ({ params }) => {
    const context = await getDeployment({
      data: {
        teamSlug: params.teamSlug,
        projectName: params.projectName,
        deploymentId: params.deploymentId,
      },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  pendingMs: 0,
  pendingMinMs: 300,
  pendingComponent: DeploymentPending,
  component: DeploymentRoute,
})

function DeploymentPending() {
  return <ProjectRoutePending section="deployment" />
}

function DeploymentRoute() {
  const context = Route.useLoaderData()

  return <DeploymentDetail context={context} />
}
