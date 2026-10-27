import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { auth } from '#devpush/server/auth/better-auth'
import { apiKeyPresetSchema } from '#devpush/lib/api-key-schema'
import type { ApiKeyPreset } from '#devpush/lib/api-key-schema'
import { PublicError } from '#devpush/lib/public-error'
import { config } from '#devpush/server/config'
import {
  createApiGrant,
  getApiKeySettings,
  revokeApiGrant,
  resolveApiGrant,
} from '#devpush/server/api/credentials'
import { db } from '#devpush/server/db'
import {
  apiGrants,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  projects,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'
import { getResourceColor } from '#devpush/server/resources/color'
import { mcpResource } from './oauth-provider'

async function readConsentQuery(oauthQuery: string) {
  if (!(await verifyOAuthQueryParams(oauthQuery, (await auth.$context).secret)))
    throw new PublicError('INVALID_INPUT')
  const query = new URLSearchParams(oauthQuery)
  if (
    !query.get('client_id') ||
    query.getAll('resource').length !== 1 ||
    query.get('resource') !== mcpResource
  )
    throw new PublicError('INVALID_INPUT')
  return query
}

export async function getMcpConsent({
  oauthQuery,
  headers,
}: {
  oauthQuery: string
  headers: Headers
}) {
  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  })
  if (!session) return null
  const query = await readConsentQuery(oauthQuery)
  const clientId = query.get('client_id')!
  const client = await auth.api.getOAuthClientPublic({
    headers,
    query: { client_id: clientId },
  })
  const requestedScopes = new Set((query.get('scope') ?? '').split(' '))
  const requestedPermissions = apiKeyPresetSchema.options.filter((preset) =>
    requestedScopes.has(`devpush:${preset}`),
  )
  if (requestedPermissions.length === 0) throw new PublicError('INVALID_INPUT')
  const settings = await getApiKeySettings(session.user.id)
  return {
    userId: session.user.id,
    clientId,
    clientName: client.client_name || clientId,
    redirectHost: (() => {
      const redirect = query.get('redirect_uri')
      if (!redirect) return null
      const uri = new URL(redirect)
      return uri.host || uri.protocol
    })(),
    requestedPermissions,
    allowLogs: requestedScopes.has('devpush:logs'),
    teams: settings.teams,
    oauthQuery,
  }
}

export async function completeMcpConsent(input: {
  oauthQuery: string
  accepted: boolean
  teamId?: string
  projectIds?: string[] | null
  preset: ApiKeyPreset
  includeLogs?: boolean
  headers: Headers
}) {
  const context = await getMcpConsent(input)
  if (!context) throw new PublicError('UNAUTHORIZED')
  const headers = new Headers(input.headers)
  let grantId: string | null = null
  if (input.accepted) {
    const session = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    })
    if (
      !session ||
      !input.teamId ||
      !context.requestedPermissions.includes(input.preset) ||
      (input.includeLogs && !context.allowLogs)
    )
      throw new PublicError('INVALID_INPUT')
    const grant = await createApiGrant({
      userId: session.user.id,
      teamId: input.teamId,
      projectIds: input.projectIds ?? null,
      preset: input.preset,
      includeLogs: input.includeLogs,
      expiresInDays: 30,
      providerGrantId: context.clientId,
    })
    grantId = grant.credentialId
    headers.set('x-devpush-mcp-grant', grantId)
  }
  const query = await readConsentQuery(input.oauthQuery)
  const requestedScopes = new Set((query.get('scope') ?? '').split(' '))
  const grantedPresets = apiKeyPresetSchema.options.slice(
    0,
    apiKeyPresetSchema.options.indexOf(input.preset) + 1,
  )
  const scopes = [
    ...grantedPresets
      .map((preset) => `devpush:${preset}`)
      .filter((scope) => requestedScopes.has(scope)),
    ...(input.includeLogs ? ['devpush:logs'] : []),
    ...(requestedScopes.has('offline_access') ? ['offline_access'] : []),
  ]
  try {
    headers.set('content-type', 'application/json')
    headers.set('accept', 'application/json')
    const response = await auth.handler(
      new Request(new URL('/api/auth/oauth2/consent', config.BETTER_AUTH_URL), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          accept: input.accepted,
          oauth_query: input.oauthQuery,
          ...(input.accepted ? { scope: scopes.join(' ') } : {}),
        }),
      }),
    )
    if (!response.ok) throw new PublicError('INVALID_INPUT')
    const result = (await response.json()) as { url?: string }
    if (!result.url) throw new PublicError('INTERNAL_ERROR')
    return { redirectUrl: result.url }
  } catch (error) {
    if (grantId) {
      const session = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true },
      })
      if (session) await revokeApiGrant(session.user.id, grantId)
    }
    throw error
  }
}

export async function listMcpConnections({
  headers,
  page: requestedPage = 1,
}: {
  headers: Headers
  page?: number
}) {
  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  })
  if (!session) throw new PublicError('UNAUTHORIZED')
  await getApiKeySettings(session.user.id)
  const filter = and(
    eq(apiGrants.userId, session.user.id),
    isNotNull(apiGrants.providerGrantId),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(apiGrants)
    .where(filter)
  const total = totalRow?.total ?? 0
  const pageSize = 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages)
  const rows = await db
    .select({
      grant: apiGrants,
      name: oauthClient.name,
      team: {
        id: teams.id,
        name: teams.name,
        image: sql<
          string | null
        >`case when ${teams.status} = 'active' and exists(
          select 1 from ${teamMembers} as current_member
          join ${user} as current_actor on current_actor.id = current_member.user_id
          where current_member.team_id = ${teams.id}
            and current_member.user_id = ${session.user.id}
            and current_actor.status = 'active'
        ) then ${teams.avatarPath} else null end`,
      },
    })
    .from(apiGrants)
    .innerJoin(teams, eq(teams.id, apiGrants.teamId))
    .leftJoin(oauthClient, eq(oauthClient.clientId, apiGrants.providerGrantId))
    .where(filter)
    .orderBy(desc(apiGrants.createdAt), desc(apiGrants.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  // Grants accept at most 100 selected projects. The single JSON-bound lookup
  // covers only this page and matches both IDs, including across different teams.
  const selectedProjects = new Map<string, [string, string]>()
  for (const { grant } of rows) {
    for (const id of grant.projectIds?.slice(0, 100) ?? []) {
      selectedProjects.set(JSON.stringify([grant.teamId, id]), [
        grant.teamId,
        id,
      ])
    }
  }
  const projectRows =
    selectedProjects.size === 0
      ? []
      : await db
          .select({
            id: projects.id,
            teamId: projects.teamId,
            name: projects.name,
            image: projects.avatarPath,
          })
          .from(
            sql`json_each(${JSON.stringify([...selectedProjects.values()])}) as connection_scope`,
          )
          .innerJoin(
            projects,
            and(
              sql`${projects.teamId} = json_extract(connection_scope.value, '$[0]')`,
              sql`${projects.id} = json_extract(connection_scope.value, '$[1]')`,
            ),
          )
          .innerJoin(
            teamMembers,
            and(
              eq(teamMembers.teamId, projects.teamId),
              eq(teamMembers.userId, session.user.id),
            ),
          )
          .innerJoin(
            teams,
            and(eq(teams.id, projects.teamId), eq(teams.status, 'active')),
          )
          .innerJoin(
            user,
            and(eq(user.id, teamMembers.userId), eq(user.status, 'active')),
          )
          .where(eq(projects.status, 'active'))
  const projectMetadata = new Map(
    projectRows.map((project) => [
      JSON.stringify([project.teamId, project.id]),
      project,
    ]),
  )
  const connections = await Promise.all(
    rows.map(async ({ grant, name, team }) => {
      let status: 'active' | 'expired' | 'revoked' | 'unavailable' =
        grant.revokedAt
          ? 'revoked'
          : grant.expiresAt.getTime() <= Date.now()
            ? 'expired'
            : 'active'
      if (status === 'active') {
        try {
          await resolveApiGrant(grant.id)
        } catch {
          status = 'unavailable'
        }
      }
      return {
        id: grant.id,
        name: name || 'MCP connection',
        team: { ...team, color: getResourceColor(team.id) },
        projects:
          grant.projectIds === null
            ? null
            : grant.projectIds.map((id) => {
                const project = projectMetadata.get(
                  JSON.stringify([grant.teamId, id]),
                )
                return {
                  id,
                  name: project?.name ?? null,
                  image: project?.image ?? null,
                  color: getResourceColor(id),
                  available: project !== undefined,
                }
              }),
        scopes: grant.scopes,
        createdAt: grant.createdAt.toISOString(),
        expiresAt: grant.expiresAt.toISOString(),
        lastUsedAt: null,
        status,
      }
    }),
  )
  return {
    connections,
    pagination: { page, pageSize, total, totalPages },
    mcpUrl: mcpResource,
  }
}

export async function revokeMcpConnection({
  id,
  headers,
}: {
  id: string
  headers: Headers
}) {
  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  })
  if (!session) throw new PublicError('UNAUTHORIZED')
  await revokeApiGrant(session.user.id, id)
  // Local authorization is revoked first. Token-family cleanup cannot revive it.
  await db.batch([
    db
      .delete(oauthConsent)
      .where(
        and(
          eq(oauthConsent.userId, session.user.id),
          eq(oauthConsent.referenceId, id),
        ),
      ),
    db
      .update(oauthAccessToken)
      .set({ revoked: new Date() })
      .where(
        and(
          eq(oauthAccessToken.userId, session.user.id),
          eq(oauthAccessToken.referenceId, id),
        ),
      ),
    db
      .update(oauthRefreshToken)
      .set({ revoked: new Date() })
      .where(
        and(
          eq(oauthRefreshToken.userId, session.user.id),
          eq(oauthRefreshToken.referenceId, id),
        ),
      ),
  ])
  return { revoked: true }
}
