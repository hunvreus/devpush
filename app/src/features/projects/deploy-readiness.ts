import type { ProjectContext } from '@/server/projects/service'

export function getDeployBlockReason(environment: ProjectContext['environment']) {
  if (!environment.serverId) {
    return 'Assign a server before deploying.'
  }

  if (environment.serverStatus !== 'connected') {
    return 'Wait until the server is connected before deploying.'
  }

  if (environment.publicRoutes.length === 0) {
    return 'Configure a public route before deploying.'
  }

  return null
}

export function hasActiveDeployment(deployments: ProjectContext['deployments']) {
  return deployments.some(
    (deployment) =>
      deployment.status === 'queued' || deployment.status === 'running',
  )
}
