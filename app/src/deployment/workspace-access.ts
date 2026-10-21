import { getDeploymentServices } from './services.server'
import type { WorkspaceOperation } from './contract'
import { PublicError } from '@/lib/public-error'

export async function withWorkspaceAccess<T>(
  teamId: string,
  operation: WorkspaceOperation,
  action: () => Promise<T>,
): Promise<T> {
  const access = getDeploymentServices().workspaceAccess
  if (!access) return action()
  try {
    return await access.run({ teamId, operation }, action)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'WorkspaceAccessError' &&
      'code' in error
    ) {
      if (
        error.code === 'SUBSCRIPTION_REQUIRED' ||
        error.code === 'PLAN_LIMIT_REACHED' ||
        error.code === 'RESOURCE_BUSY'
      )
        throw new PublicError(error.code)
    }
    throw error
  }
}
