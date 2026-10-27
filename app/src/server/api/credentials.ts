import { withWorkspaceAccess } from '#devpush/server/plugins/workspace-access'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { SQL } from 'drizzle-orm'
import {
  createApiKeySchema,
  apiRoleRank,
  apiScopeDefinitions,
  apiKeySettingsSchema,
  apiKeyTeamsSchema,
  apiKeyProjectsSchema,
  apiKeyMaxExpirationDays,
  scopesForApiPreset,
} from '#devpush/lib/api-key-schema'
import { PublicError } from '#devpush/lib/public-error'
import type {
  ApiKeySummary,
  ApiKeyTeamOption,
  ApiKeyProjectOption,
  ApiScope,
} from '#devpush/lib/api-key-schema'
import type { TeamRole } from '#devpush/lib/team-role'
import { db } from '#devpush/server/db'
import type { AtomicStore } from '#devpush/server/db/atomic'
import {
  apiGrants,
  apiKeys,
  projects,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'
import type { ApiPrincipal } from './authorization'
import { apiAuthorizationCondition } from './authorization'
import { getResourceColor } from '#devpush/server/resources/color'

type CredentialRow = {
  id: string
  userId: string
  teamId: string
  membershipId: string
  roleCeiling: TeamRole
  projectIds: string | null
  scopes: string
  expiresAt: number | null
  revokedAt: number | null
  createdAt: number
  providerGrantId?: string | null
}
type KeyRow = CredentialRow & {
  name: string
  prefix: string
  preset: ApiKeySummary['preset']
  lastUsedAt: number | null
  teamName: string
}
type Member = { membershipId: string; role: TeamRole }

const credentialColumnNames = [
  'id',
  'userId',
  'teamId',
  'membershipId',
  'roleCeiling',
  'projectIds',
  'scopes',
  'expiresAt',
  'revokedAt',
  'createdAt',
] as const
const keyColumnNames = [
  ...credentialColumnNames,
  'name',
  'prefix',
  'preset',
  'lastUsedAt',
  'teamName',
] as const

async function readRows<T>(
  store: AtomicStore,
  query: SQL,
  columns: readonly string[],
): Promise<T[]> {
  const rows = await store.all(query)
  // sqlite-proxy preserves positional rows; D1's raw SQL API returns records.
  return rows.map(
    (row) =>
      (Array.isArray(row)
        ? Object.fromEntries(
            columns.map((column, index) => [column, row[index]]),
          )
        : row) as T,
  )
}

const credentialColumns = sql`credential.id, credential.user_id as userId, credential.team_id as teamId,
  credential.membership_id as membershipId, credential.role_ceiling as roleCeiling,
  credential.project_ids as projectIds, credential.scopes, credential.expires_at as expiresAt,
  credential.revoked_at as revokedAt, credential.created_at as createdAt`

function activeMemberGuard(
  userId: string,
  teamId: string,
  membershipId: string,
  role?: TeamRole,
) {
  return sql`exists(select 1 from ${teamMembers} as member
    join ${user} as actor on actor.id = member.user_id
    join ${teams} as member_team on member_team.id = member.team_id
    where member.id = ${membershipId} and member.user_id = ${userId} and member.team_id = ${teamId}
      and actor.status = 'active' and member_team.status = 'active'
      ${role ? sql`and member.role = ${role}` : sql``})`
}

async function requireMember(
  store: AtomicStore,
  userId: string,
  teamId: string,
): Promise<Member> {
  const [member] = await readRows<Member>(
    store,
    sql`select member.id as membershipId, member.role
    from ${teamMembers} as member join ${user} as actor on actor.id = member.user_id
    join ${teams} as member_team on member_team.id = member.team_id
    where member.user_id = ${userId} and member.team_id = ${teamId}
      and actor.status = 'active' and member_team.status = 'active' limit 1`,
    ['membershipId', 'role'],
  )
  if (!member) throw new PublicError('FORBIDDEN')
  return member
}

async function requireActiveUser(store: AtomicStore, userId: string) {
  const rows = await store.all(
    sql`select id from ${user} where id = ${userId} and status = 'active' limit 1`,
  )
  if (rows.length !== 1) throw new PublicError('UNAUTHORIZED')
}

function projectSelectionGuard(teamId: string, projectIds: string[] | null) {
  return projectIds === null
    ? sql`1`
    : sql`(select count(*) from ${projects} where team_id = ${teamId} and status = 'active'
    and id in (${sql.join(
      projectIds.map((id) => sql`${id}`),
      sql`, `,
    )})) = ${projectIds.length}`
}

function principalFrom(
  row: CredentialRow,
  currentRole: TeamRole,
  credentialKind: 'api_key' | 'oauth',
): ApiPrincipal {
  const roleCeiling =
    apiRoleRank[currentRole] < apiRoleRank[row.roleCeiling]
      ? currentRole
      : row.roleCeiling
  const storedScopes = JSON.parse(row.scopes) as string[]
  return {
    userId: row.userId,
    teamId: row.teamId,
    membershipId: row.membershipId,
    roleCeiling,
    projectIds: row.projectIds === null ? null : JSON.parse(row.projectIds),
    scopes: storedScopes.filter(
      (scope): scope is ApiScope =>
        scope in apiScopeDefinitions &&
        apiRoleRank[roleCeiling] >=
          apiRoleRank[apiScopeDefinitions[scope as ApiScope].minimumRole],
    ),
    credentialId: row.id,
    credentialKind,
    providerGrantId: row.providerGrantId,
  }
}

async function resolveCredential(
  store: AtomicStore,
  row: CredentialRow | undefined,
  credentialKind: 'api_key' | 'oauth',
) {
  if (
    !row ||
    row.revokedAt !== null ||
    (row.expiresAt === null
      ? credentialKind === 'oauth'
      : row.expiresAt <= Date.now())
  )
    throw new PublicError('UNAUTHORIZED')
  let member: Member
  try {
    member = await requireMember(store, row.userId, row.teamId)
  } catch (error) {
    if (error instanceof PublicError) throw new PublicError('UNAUTHORIZED')
    throw error
  }
  if (member.membershipId !== row.membershipId)
    throw new PublicError('UNAUTHORIZED')
  return principalFrom(row, member.role, credentialKind)
}

export async function hashApiSecret(secret: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `dp_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** Public bearer authentication intentionally ignores browser cookies. */
export async function authenticateApiKey(
  request: Request,
  store: AtomicStore = db,
): Promise<ApiPrincipal> {
  const match = request.headers
    .get('authorization')
    ?.match(/^Bearer (dp_[a-f0-9]{64})$/i)
  if (!match) throw new PublicError('UNAUTHORIZED')
  const keyHash = await hashApiSecret(match[1]!)
  const [row] = await readRows<CredentialRow>(
    store,
    sql`select ${credentialColumns} from ${apiKeys} as credential where key_hash = ${keyHash} limit 1`,
    credentialColumnNames,
  )
  const principal = await resolveCredential(store, row, 'api_key')
  const rows =
    await store.all(sql`update ${apiKeys} set last_used_at = ${Date.now()} where id = ${principal.credentialId}
    and ${apiAuthorizationCondition(principal)} returning id`)
  if (rows.length !== 1) throw new PublicError('UNAUTHORIZED')
  return principal
}

export async function resolveApiGrant(
  grantId: string,
  store: AtomicStore = db,
): Promise<ApiPrincipal> {
  const [row] = await readRows<CredentialRow>(
    store,
    sql`select ${credentialColumns}, credential.provider_grant_id as providerGrantId from ${apiGrants} as credential where id = ${grantId} limit 1`,
    [...credentialColumnNames, 'providerGrantId'],
  )
  const principal = await resolveCredential(store, row, 'oauth')
  const valid = await store.all(
    sql`select 1 where ${apiAuthorizationCondition(principal)}`,
  )
  if (valid.length !== 1) throw new PublicError('UNAUTHORIZED')
  return principal
}

function keySummary(row: KeyRow, available: boolean): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    teamId: row.teamId,
    teamName: row.teamName,
    projectIds: row.projectIds === null ? null : JSON.parse(row.projectIds),
    preset: row.preset,
    scopes: JSON.parse(row.scopes),
    status:
      row.revokedAt !== null
        ? 'revoked'
        : row.expiresAt !== null && row.expiresAt <= Date.now()
          ? 'expired'
          : available
            ? 'active'
            : 'unavailable',
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt:
      row.expiresAt === null ? null : new Date(row.expiresAt).toISOString(),
    lastUsedAt:
      row.lastUsedAt === null ? null : new Date(row.lastUsedAt).toISOString(),
    revokedAt:
      row.revokedAt === null ? null : new Date(row.revokedAt).toISOString(),
  }
}

async function readKey(store: AtomicStore, userId: string, id: string) {
  const [row] = await readRows<KeyRow>(
    store,
    sql`select ${credentialColumns}, credential.name, credential.prefix, credential.preset,
    credential.last_used_at as lastUsedAt, member_team.name as teamName
    from ${apiKeys} as credential join ${teams} as member_team on member_team.id = credential.team_id
    where credential.id = ${id} and credential.user_id = ${userId} limit 1`,
    keyColumnNames,
  )
  if (!row) throw new PublicError('FORBIDDEN')
  return row
}

export async function getApiKeySettings(
  userId: string,
  store: AtomicStore = db,
  options: { page?: number } = {},
): Promise<{
  keys: ApiKeySummary[]
  teams: ApiKeyTeamOption[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}> {
  await requireActiveUser(store, userId)
  const requested = apiKeySettingsSchema.parse(options)
  const [count] = await readRows<{ total: number }>(
    store,
    sql`select count(*) as total from ${apiKeys} where user_id = ${userId}`,
    ['total'],
  )
  const pageSize = 25
  const total = Number(count?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requested.page, totalPages)
  const teamOptions = await getApiKeyTeams(userId, {}, store)
  const keyRows = await readRows<KeyRow>(
    store,
    sql`select ${credentialColumns}, credential.name, credential.prefix, credential.preset,
    credential.last_used_at as lastUsedAt, member_team.name as teamName
    from ${apiKeys} as credential join ${teams} as member_team on member_team.id = credential.team_id
    where credential.user_id = ${userId}
    order by credential.revoked_at is not null, (credential.expires_at is not null and credential.expires_at <= ${Date.now()}), credential.created_at desc, credential.id
    limit ${pageSize} offset ${(page - 1) * pageSize}`,
    keyColumnNames,
  )
  const keys = keyRows.map((row) => keySummary(row, true))
  return {
    keys,
    pagination: { page, pageSize, total, totalPages },
    teams: teamOptions.items,
  }
}

function searchPattern(query: string) {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`
}
function pageInfo(total: number, requested: number) {
  const pageSize = 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return { page: Math.min(requested, totalPages), pageSize, total, totalPages }
}

export async function getApiKeyTeams(
  userId: string,
  input: unknown = {},
  store: AtomicStore = db,
) {
  await requireActiveUser(store, userId)
  const data = apiKeyTeamsSchema.parse(input)
  const filter = sql`member.user_id = ${userId} and member_team.status = 'active'
    and (member_team.name like ${searchPattern(data.query)} escape '\\' or member_team.slug like ${searchPattern(data.query)} escape '\\')`
  const [count] = await readRows<{ total: number }>(
    store,
    sql`select count(*) as total from ${teamMembers} as member
    join ${teams} as member_team on member_team.id = member.team_id where ${filter}`,
    ['total'],
  )
  const pagination = pageInfo(Number(count?.total ?? 0), data.page)
  const rows = await readRows<Omit<ApiKeyTeamOption, 'projects' | 'color'>>(
    store,
    sql`select member_team.id, member_team.name, member_team.slug, member.role, member_team.avatar_path as image
    from ${teamMembers} as member join ${teams} as member_team on member_team.id = member.team_id
    where ${filter} order by member_team.name, member_team.id limit ${pagination.pageSize} offset ${(pagination.page - 1) * pagination.pageSize}`,
    ['id', 'name', 'slug', 'role', 'image'],
  )
  return {
    items: rows.map((row) => ({
      ...row,
      color: getResourceColor(row.id),
      projects: [],
    })),
    pagination,
  }
}

export async function getApiKeyProjects(
  userId: string,
  input: unknown,
  store: AtomicStore = db,
) {
  const data = apiKeyProjectsSchema.parse(input)
  await requireMember(store, userId, data.teamId)
  const filter = sql`${projects.teamId} = ${data.teamId} and ${projects.status} = 'active'
    and (${projects.name} like ${searchPattern(data.query)} escape '\\' or ${projects.slug} like ${searchPattern(data.query)} escape '\\')`
  const [count] = await readRows<{ total: number }>(
    store,
    sql`select count(*) as total from ${projects} where ${filter}`,
    ['total'],
  )
  const pagination = pageInfo(Number(count?.total ?? 0), data.page)
  const rows = await readRows<Omit<ApiKeyProjectOption, 'color'>>(
    store,
    sql`select ${projects.id} as id,${projects.name} as name,${projects.slug} as slug,${projects.avatarPath} as avatarUrl
    from ${projects} where ${filter} order by ${projects.name}, ${projects.id} limit ${pagination.pageSize} offset ${(pagination.page - 1) * pagination.pageSize}`,
    ['id', 'name', 'slug', 'avatarUrl'],
  )
  return {
    items: rows.map((row) => ({ ...row, color: getResourceColor(row.id) })),
    pagination,
  }
}

export async function createApiKey(
  userId: string,
  input: unknown,
  store: AtomicStore = db,
) {
  const data = createApiKeySchema.parse(input)
  const member = await requireMember(store, userId, data.teamId)
  return withWorkspaceAccess(
    data.teamId,
    'credential.create',
    async () => {
      const scopes = scopesForApiPreset(
        data.preset,
        member.role,
        data.includeLogs,
      )
      const id = crypto.randomUUID()
      const secret = newSecret()
      const keyHash = await hashApiSecret(secret)
      const now = Date.now()
      const expiresAt =
        data.expiresInDays === null
          ? null
          : now + data.expiresInDays * 86_400_000
      const inserted =
        await store.all(sql`insert into ${apiKeys} (id,user_id,team_id,membership_id,name,prefix,key_hash,role_ceiling,preset,project_ids,scopes,expires_at,created_at)
    select ${id},${userId},${data.teamId},${member.membershipId},${data.name},${secret.slice(0, 11)},${keyHash},${member.role},${data.preset},${data.projectIds === null ? null : JSON.stringify(data.projectIds)},${JSON.stringify(scopes)},${expiresAt},${now}
    where ${activeMemberGuard(userId, data.teamId, member.membershipId, member.role)}
      and ${projectSelectionGuard(data.teamId, data.projectIds)}
      and (select count(*) from ${apiKeys} where user_id = ${userId} and revoked_at is null
        and (expires_at is null or expires_at > cast(unixepoch('subsec') * 1000 as integer))) < 100
    returning id`)
      if (inserted.length !== 1)
        throw new PublicError('API_KEY_CREATION_UNAVAILABLE')
      return { key: keySummary(await readKey(store, userId, id), true), secret }
    },
    { kind: 'user', userId: userId },
  )
}

export async function revokeApiKey(
  userId: string,
  id: string,
  store: AtomicStore = db,
) {
  await requireActiveUser(store, userId)
  const result =
    await store.all(sql`update ${apiKeys} set revoked_at = coalesce(revoked_at,${Date.now()})
    where id = ${id} and user_id = ${userId} and exists(select 1 from ${user} where id = ${userId} and status = 'active') returning id`)
  if (result.length !== 1) throw new PublicError('FORBIDDEN')
}

export async function rotateApiKey(
  userId: string,
  id: string,
  store: AtomicStore = db,
) {
  const old = await readKey(store, userId, id)
  if (old.revokedAt !== null) throw new PublicError('API_KEY_REVOKED')
  if (old.expiresAt !== null && old.expiresAt <= Date.now())
    throw new PublicError('API_KEY_EXPIRED')
  const member = await requireMember(store, userId, old.teamId)
  return withWorkspaceAccess(
    old.teamId,
    'credential.rotate',
    async () => {
      if (member.membershipId !== old.membershipId)
        throw new PublicError('FORBIDDEN')
      const principal = principalFrom(old, member.role, 'api_key')
      const newId = crypto.randomUUID()
      const secret = newSecret()
      const keyHash = await hashApiSecret(secret)
      const now = Date.now()
      const expiresAt =
        old.expiresAt === null
          ? null
          : now +
            Math.min(
              apiKeyMaxExpirationDays * 86_400_000,
              Math.max(86_400_000, old.expiresAt - old.createdAt),
            )
      const result = await store.batch([
        store.all(sql`insert into ${apiKeys} (id,user_id,team_id,membership_id,name,prefix,key_hash,role_ceiling,preset,project_ids,scopes,expires_at,created_at)
      select ${newId},user_id,team_id,membership_id,name,${secret.slice(0, 11)},${keyHash},${principal.roleCeiling},preset,project_ids,${JSON.stringify(principal.scopes)},${expiresAt},${now}
      from ${apiKeys} where id = ${id} and user_id = ${userId} and revoked_at is null
        and (expires_at is null or expires_at > cast(unixepoch('subsec') * 1000 as integer))
        and (select count(*) from ${apiKeys} where user_id = ${userId} and revoked_at is null
          and (expires_at is null or expires_at > cast(unixepoch('subsec') * 1000 as integer))) <= 100
        and ${activeMemberGuard(userId, old.teamId, old.membershipId, member.role)}
        and ${projectSelectionGuard(old.teamId, principal.projectIds)} returning id`),
        store.run(
          sql`update ${apiKeys} set revoked_at = ${now} where id = ${id} and exists(select 1 from ${apiKeys} where id = ${newId})`,
        ),
      ])
      if (result[0].length !== 1) throw new PublicError('FORBIDDEN')
      return {
        key: keySummary(await readKey(store, userId, newId), true),
        secret,
      }
    },
    { kind: 'user', userId: userId },
  )
}

export async function createApiGrant(
  input: {
    userId: string
    teamId: string
    projectIds: string[] | null
    preset: 'read' | 'deploy' | 'manage'
    expiresInDays: number
    includeLogs?: boolean
    providerGrantId?: string
  },
  store: AtomicStore = db,
) {
  const data = createApiKeySchema
    .safeExtend({ expiresInDays: z.number().int().min(1).max(90) })
    .parse({
      name: 'MCP connection',
      teamId: input.teamId,
      projectIds: input.projectIds,
      preset: input.preset,
      expiresInDays: input.expiresInDays,
      includeLogs: input.includeLogs ?? false,
    })
  const member = await requireMember(store, input.userId, data.teamId)
  return withWorkspaceAccess(
    data.teamId,
    'credential.create',
    async () => {
      const id = crypto.randomUUID()
      const now = Date.now()
      const rows =
        await store.all(sql`insert into ${apiGrants} (id,user_id,team_id,membership_id,role_ceiling,project_ids,scopes,provider_grant_id,expires_at,created_at)
    select ${id},${input.userId},${data.teamId},${member.membershipId},${member.role},${data.projectIds === null ? null : JSON.stringify(data.projectIds)},${JSON.stringify(scopesForApiPreset(data.preset, member.role, data.includeLogs))},${input.providerGrantId ?? null},${now + data.expiresInDays * 86_400_000},${now}
    where ${activeMemberGuard(input.userId, data.teamId, member.membershipId, member.role)} and ${projectSelectionGuard(data.teamId, data.projectIds)}
      and (select count(*) from ${apiGrants} where user_id = ${input.userId} and revoked_at is null and expires_at > ${now}) < 100 returning id`)
      if (rows.length !== 1)
        throw new PublicError('MCP_CONNECTION_CREATION_UNAVAILABLE')
      return resolveApiGrant(id, store)
    },
    { kind: 'user', userId: input.userId },
  )
}

export async function revokeApiGrant(
  userId: string,
  grantId: string,
  store: AtomicStore = db,
) {
  await requireActiveUser(store, userId)
  const rows =
    await store.all(sql`update ${apiGrants} set revoked_at = coalesce(revoked_at,${Date.now()}) where id = ${grantId} and user_id = ${userId}
    and exists(select 1 from ${user} where id = ${userId} and status = 'active') returning id`)
  if (rows.length !== 1) throw new PublicError('FORBIDDEN')
}
