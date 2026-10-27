import { PublicError } from '#devpush/lib/public-error'
import { db } from '#devpush/server/db'
import {
  agentJobs,
  backupRuns,
  deployments,
  environments,
  projects,
  servers,
  teams,
  user,
} from '#devpush/server/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { ApiPrincipal } from './authorization'
import { apiAuthorizationCondition, requireApiProject } from './authorization'
import { ApiError } from './errors'
import type { PublicApiOperation } from './operation-contract'

export const serverSelection = {
  id: servers.id,
  teamId: servers.teamId,
  settingsVersion: servers.settingsVersion,
  name: servers.name,
  status: servers.status,
  publicAddress: servers.publicAddress,
  agentVersion: servers.agentVersion,
  lastSeenAt: servers.lastSeenAt,
  createdAt: servers.createdAt,
}
type Input = Record<string, any>
export type OperationContext = {
  operation: PublicApiOperation
  principal: ApiPrincipal
  input: Input
  requestId: string
}

export async function assertCurrentAuthorization({
  operation,
  principal,
  input,
}: OperationContext) {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.id, principal.userId),
        apiAuthorizationCondition(principal, {
          scope: operation.scope,
          projectId: input.projectId,
          allowDeletedProject: operation.id === 'delete_project',
          minimumRole: operation.minimumRole,
        }),
      ),
    )
    .limit(1)
  if (!rows[0]) throw new PublicError('FORBIDDEN')
}
export function projectGuard(principal: ApiPrincipal, scope: string) {
  return and(
    eq(projects.teamId, principal.teamId),
    eq(projects.status, 'active'),
    apiAuthorizationCondition(principal, { scope }),
    principal.projectIds === null
      ? undefined
      : sql`${projects.id} in (select value from json_each(${JSON.stringify(principal.projectIds)}))`,
  )
}
export async function projectRow(context: OperationContext, projectId: string) {
  await requireApiProject(context.principal, projectId)
  const [row] = await db
    .select({ project: projects, teamSlug: teams.slug })
    .from(projects)
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .where(
      and(
        eq(projects.id, projectId),
        projectGuard(context.principal, context.operation.scope),
      ),
    )
    .limit(1)
  if (!row) throw new ApiError('NOT_FOUND', 404)
  return row
}
export async function deploymentRow(context: OperationContext, id: string) {
  const [row] = await db
    .select({ deployment: deployments, projectId: projects.id })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(
        eq(deployments.id, id),
        projectGuard(context.principal, context.operation.scope),
      ),
    )
    .limit(1)
  if (!row) throw new ApiError('NOT_FOUND', 404)
  return { ...row, ...(await projectRow(context, row.projectId)) }
}
export async function backupRow(context: OperationContext, id: string) {
  const [row] = await db
    .select({ backup: backupRuns, projectId: projects.id })
    .from(backupRuns)
    .innerJoin(projects, eq(projects.id, backupRuns.projectId))
    .where(
      and(
        eq(backupRuns.id, id),
        projectGuard(context.principal, context.operation.scope),
      ),
    )
    .limit(1)
  if (!row) throw new ApiError('NOT_FOUND', 404)
  return { ...row, ...(await projectRow(context, row.projectId)) }
}
export async function jobRow(context: OperationContext, id: string) {
  const [row] = await db
    .select({ job: agentJobs, projectId: projects.id })
    .from(agentJobs)
    .innerJoin(projects, eq(projects.id, agentJobs.projectId))
    .where(
      and(
        eq(agentJobs.id, id),
        projectGuard(context.principal, context.operation.scope),
        sql`${agentJobs.type} in ('backup','restore','backup_cleanup')`,
      ),
    )
    .limit(1)
  if (!row) throw new ApiError('NOT_FOUND', 404)
  return row
}
export function requireWholeTeam(principal: ApiPrincipal) {
  if (principal.projectIds !== null) throw new PublicError('FORBIDDEN')
}
export function serialize<T>(value: T): T {
  // Explicit selections define the response; conversion only serializes dates.
  return JSON.parse(JSON.stringify(value)) as T
}
