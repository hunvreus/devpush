import type { ProjectContext } from '@/server/projects/types'

export function getDeployBlockReason(
  environment: ProjectContext['environment'],
) {
  if (!environment.serverId) {
    return 'Assign a server before deploying.'
  }

  if (environment.serverStatus !== 'connected') {
    return 'Wait until the server is connected before deploying.'
  }

  if (environment.serverAgentUpdate?.status === 'required') {
    return 'Update the server agent before deploying.'
  }

  return null
}

export function hasActiveDeployment(
  deployments: ProjectContext['deployments'],
) {
  return deployments.some(
    (deployment) =>
      deployment.status === 'queued' || deployment.status === 'running',
  )
}
