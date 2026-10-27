import { sql } from 'drizzle-orm'
import { apiRoleRank, apiScopeDefinitions } from '#devpush/lib/api-key-schema'
import { PublicError } from '#devpush/lib/public-error'
import type { ApiScope } from '#devpush/lib/api-key-schema'
import type { TeamRole } from '#devpush/lib/team-role'
import {
  apiGrants,
  apiKeys,
  projects,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'

export type ApiPrincipal = {
  userId: string
  teamId: string
  membershipId: string
  roleCeiling: TeamRole
  projectIds: string[] | null
  scopes: string[]
  credentialId: string
  credentialKind?: 'api_key' | 'oauth'
  providerGrantId?: string | null
}

export function requireApiScope(
  principal: ApiPrincipal,
  scope: string,
  minimumRole: TeamRole = 'member',
) {
  const definition = Object.hasOwn(apiScopeDefinitions, scope)
    ? apiScopeDefinitions[scope as ApiScope]
    : undefined
  if (
    !definition ||
    !principal.scopes.includes(scope) ||
    apiRoleRank[principal.roleCeiling] <
      Math.max(apiRoleRank[definition.minimumRole], apiRoleRank[minimumRole])
  ) {
    throw new PublicError('FORBIDDEN')
  }
}

export function requireApiProject(principal: ApiPrincipal, projectId: string) {
  if (
    principal.projectIds !== null &&
    !principal.projectIds.includes(projectId)
  ) {
    throw new PublicError('FORBIDDEN')
  }
}

/** Recheck live credentials and membership at the SQL admission point. */
export function apiAuthorizationCondition(
  principal: ApiPrincipal,
  options: {
    scope?: string
    projectId?: string
    teamId?: string
    minimumRole?: TeamRole
    allowDeletedProject?: boolean
  } = {},
) {
  if (options.teamId && options.teamId !== principal.teamId) return sql`0`
  if (
    options.projectId &&
    principal.projectIds !== null &&
    !principal.projectIds.includes(options.projectId)
  )
    return sql`0`
  const definition =
    options.scope && Object.hasOwn(apiScopeDefinitions, options.scope)
      ? apiScopeDefinitions[options.scope as ApiScope]
      : undefined
  if (
    options.scope &&
    (!definition || !principal.scopes.includes(options.scope))
  )
    return sql`0`
  const rank = Math.max(
    apiRoleRank[options.minimumRole ?? 'member'],
    apiRoleRank[definition?.minimumRole ?? 'member'],
  )
  if (apiRoleRank[principal.roleCeiling] < rank) return sql`0`
  const credential = principal.credentialKind === 'oauth' ? apiGrants : apiKeys
  const expirationGuard =
    principal.credentialKind === 'oauth'
      ? sql`credential.expires_at > cast(unixepoch('subsec') * 1000 as integer)`
      : sql`(credential.expires_at is null or credential.expires_at > cast(unixepoch('subsec') * 1000 as integer))`
  const scopeGuard = options.scope
    ? sql`exists(select 1 from json_each(credential.scopes) where value = ${options.scope})`
    : sql`1`
  const projectGuard = options.projectId
    ? sql`exists(select 1 from ${projects} as granted_project where granted_project.id = ${options.projectId} and granted_project.team_id = ${principal.teamId} and ${options.allowDeletedProject ? sql`granted_project.status in ('active','deleted')` : sql`granted_project.status = 'active'`})
    and (credential.project_ids is null or exists(select 1 from json_each(credential.project_ids) where value = ${options.projectId}))`
    : sql`1`
  const roleRank = (column: ReturnType<typeof sql>) =>
    sql`case ${column} when 'owner' then 2 when 'admin' then 1 else 0 end`
  return sql`exists (
    select 1 from ${credential} as credential
    join ${teamMembers} as membership on membership.id = credential.membership_id
    join ${user} as actor on actor.id = credential.user_id
    join ${teams} as actor_team on actor_team.id = credential.team_id
    where credential.id = ${principal.credentialId}
      and credential.user_id = ${principal.userId} and credential.team_id = ${principal.teamId}
      and credential.membership_id = ${principal.membershipId}
      and membership.user_id = credential.user_id and membership.team_id = credential.team_id
      and actor.status = 'active' and actor_team.status = 'active'
      and credential.revoked_at is null and ${expirationGuard}
      and ${roleRank(sql`membership.role`)} >= ${rank}
      and ${roleRank(sql`credential.role_ceiling`)} >= ${rank}
      and ${scopeGuard} and ${projectGuard}
  )`
}
