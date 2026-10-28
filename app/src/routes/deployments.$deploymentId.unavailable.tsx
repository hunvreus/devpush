import { createFileRoute, redirect } from '@tanstack/react-router'
import { getUnavailableDeployment } from '#devpush/server/projects/functions'

export const Route = createFileRoute('/deployments/$deploymentId/unavailable')({
  ssr: false,
  loader: async ({ params }) => {
    const target = await getUnavailableDeployment({ data: params })
    if (!target)
      throw redirect({
        to: '/auth/login',
        search: {
          redirect: `/deployments/${encodeURIComponent(params.deploymentId)}/unavailable`,
        },
      })
    throw redirect({
      to: '/$teamSlug/projects/$projectName/deployments/$deploymentId',
      params: { ...target, deploymentId: params.deploymentId },
      search: { unavailable: true },
    })
  },
})
