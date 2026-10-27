import { PublicError } from '#devpush/lib/public-error'
import { requireBackupsEnabled } from '#devpush/server/backups/feature'
import { enforceRateLimit } from '#devpush/server/http/rate-limit'
import type { ApiPrincipal } from './authorization'
import { requireApiProject, requireApiScope } from './authorization'
import { ApiError } from './errors'
import { findPublicApiOperation } from './operation-contract'

import type { OperationContext } from './operation-context'
import {
  assertCurrentAuthorization,
  requireWholeTeam,
} from './operation-context'

import { mutateOperation } from './mutation-operations'
import { readOperation } from './read-operations'

export async function executeApiOperation({
  operationId,
  input,
  principal,
  requestId,
  idempotencyKey,
}: {
  operationId: string
  input: unknown
  principal: ApiPrincipal
  requestId: string
  idempotencyKey?: string
}) {
  const operation = findPublicApiOperation(operationId)
  if (!operation) throw new ApiError('NOT_FOUND', 404)
  const parsed = operation.input.parse(
    idempotencyKey && input && typeof input === 'object'
      ? { ...input, idempotencyKey }
      : input,
  )
  requireApiScope(principal, operation.scope, operation.minimumRole)
  if (operation.requiresWholeTeam) requireWholeTeam(principal)
  const context: OperationContext = {
    operation,
    principal,
    input: parsed,
    requestId,
  }
  if (typeof parsed.projectId === 'string')
    await requireApiProject(principal, parsed.projectId)
  // Never use a serialized principal as a fresh authorization snapshot.
  await assertCurrentAuthorization(context)
  if (!operation.readOnly && operation.scope.startsWith('backups:'))
    requireBackupsEnabled()
  const limited = await enforceRateLimit({
    identity: principal.membershipId,
    scope: `public-operation:${operation.readOnly ? 'read' : operation.id}`,
    limit: operation.readOnly ? 120 : 20,
    windowMs: 60_000,
  })
  if (limited) throw new PublicError('RATE_LIMITED')
  const result = operation.readOnly
    ? await readOperation(context)
    : await mutateOperation(context)
  await assertCurrentAuthorization(context)
  return { status: operation.status, data: operation.output.parse(result) }
}
