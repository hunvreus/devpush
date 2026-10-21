import deployment from '#devpush/deployment/server'
import { deploymentApiVersion, validateDeploymentServices } from './contract'
import { deploymentContext } from './server-context'

export function getDeploymentServices() {
  if (deployment.apiVersion !== deploymentApiVersion)
    throw new Error('Incompatible devpush deployment API version.')
  return validateDeploymentServices(
    deployment.create(process.env, deploymentContext),
  )
}
