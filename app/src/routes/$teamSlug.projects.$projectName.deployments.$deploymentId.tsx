import { createFileRoute, redirect } from '@tanstack/react-router'

import { DeploymentDetail } from '@/features/deployments/deployment-detail'
import { ProjectLayout } from '@/features/projects/project-layout'
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
  component: DeploymentRoute,
})

function DeploymentRoute() {
  const context = Route.useLoaderData()

  return (
    <ProjectLayout context={context} contentClassName="space-y-8">
      <DeploymentDetail context={context} />
    </ProjectLayout>
  )
}
