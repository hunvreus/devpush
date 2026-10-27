import { getPluginServices } from './services.server'
import type {
  WorkspaceOperation,
  WorkspaceActor,
} from '#devpush/plugins/contract'
import { WorkspacePolicyError } from '#devpush/plugins/server'
import { PublicError } from '#devpush/lib/public-error'

declare const admissionBrand: unique symbol
export interface WorkspaceAdmission {
  readonly teamId: string
  readonly operation: WorkspaceOperation
  readonly [admissionBrand]: true
}
const activeAdmissions = new WeakSet<object>()
export function requireWorkspaceAdmission(
  admission: WorkspaceAdmission,
  teamId: string,
  operation: WorkspaceOperation,
) {
  if (
    !activeAdmissions.has(admission) ||
    admission.teamId !== teamId ||
    admission.operation !== operation
  )
    throw new Error('Invalid workspace mutation admission.')
}

export async function withWorkspaceAccess<T>(
  teamId: string,
  operation: WorkspaceOperation,
  action: (admission: WorkspaceAdmission) => Promise<T>,
  actor: WorkspaceActor,
): Promise<T> {
  const access = getPluginServices().workspaceAccess
  const invoke = async () => {
    const admission = Object.freeze({ teamId, operation }) as WorkspaceAdmission
    activeAdmissions.add(admission)
    try {
      return await action(admission)
    } finally {
      activeAdmissions.delete(admission)
    }
  }
  if (!access) return invoke()
  try {
    return await access.run({ teamId, operation, actor }, invoke)
  } catch (error) {
    if (error instanceof WorkspacePolicyError) {
      const codes = {
        restricted: 'WORKSPACE_RESTRICTED',
        limit: 'WORKSPACE_LIMIT_REACHED',
        busy: 'RESOURCE_BUSY',
      } as const
      throw new PublicError(codes[error.reason], undefined, error.publicDetails)
    }
    throw error
  }
}

/** No core effect is performed; the policy may still do its own accounting or I/O. */
export async function checkWorkspaceAccess(
  teamId: string,
  operation: WorkspaceOperation,
  actor: WorkspaceActor,
) {
  return withWorkspaceAccess(teamId, operation, async () => undefined, actor)
}
export function isWorkspacePolicyRefusal(error: unknown): boolean {
  return (
    error instanceof PublicError &&
    ['WORKSPACE_RESTRICTED', 'WORKSPACE_LIMIT_REACHED'].includes(error.code)
  )
}
