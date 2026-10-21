import { describe, expect, test } from 'vitest'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { eq, sql } from 'drizzle-orm'
import { apiGrants, projects, teamMembers, teams } from '@/server/db/schema'
import { makeSignature } from 'better-auth/crypto'
import { auth } from '@/server/auth/better-auth'
import { db } from '@/server/db'
import { createApiKey, revokeApiGrant } from '@/server/api/credentials'
import { getResourceColor } from '@/server/resources/color'
import {
  getMcpConsent,
  completeMcpConsent,
  listMcpConnections,
  revokeMcpConnection,
} from './connections'
import { authenticateMcpRequest, handleMcpRequest } from './handler'
import { mcpResource } from './oauth-provider'

async function seed() {
  const userId = crypto.randomUUID(),
    teamId = crypto.randomUUID(),
    membershipId = crypto.randomUUID()
  await db.batch([
    db.run(
      sql`insert into user(id,name,username,email) values(${userId},'MCP user',${userId},${userId + '@example.invalid'})`,
    ),
    db.run(
      sql`insert into teams(id,name,slug) values(${teamId},'MCP team',${teamId})`,
    ),
    db.run(
      sql`insert into team_members(id,user_id,team_id,role) values(${membershipId},${userId},${teamId},'admin')`,
    ),
  ])
  const context = await auth.$context
  const session = await context.internalAdapter.createSession(userId)
  const signature = await makeSignature(session.token, context.secret)
  const headers = new Headers({
    cookie: `devpush.session_token=${encodeURIComponent(session.token + '.' + signature)}`,
    origin: 'http://localhost:7429',
  })
  return { userId, teamId, membershipId, headers }
}

async function seedConnection(
  context: Awaited<ReturnType<typeof seed>>,
  projectIds: string[] | null,
) {
  const id = crypto.randomUUID()
  await db.insert(apiGrants).values({
    id,
    userId: context.userId,
    teamId: context.teamId,
    membershipId: context.membershipId,
    roleCeiling: 'admin',
    projectIds,
    scopes: ['projects:read'],
    providerGrantId: 'scope-metadata-client',
    expiresAt: new Date(Date.now() + 3600000),
  })
  return id
}
async function oauthRequest(
  path: string,
  body: Record<string, string> | object,
  headers = new Headers(),
  form = false,
) {
  return auth.handler(
    new Request(`http://localhost:7429/api/auth${path}`, {
      method: 'POST',
      headers: {
        ...Object.fromEntries(headers),
        'content-type': form
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
      },
      body: form
        ? new URLSearchParams(body as Record<string, string>).toString()
        : JSON.stringify(body),
    }),
  )
}
async function authorize(
  preset: 'read' | 'manage' = 'read',
  includeLogs = false,
) {
  const ids = await seed()
  const registration = await oauthRequest('/oauth2/register', {
    client_name: 'Test assistant',
    redirect_uris: ['http://127.0.0.1:9000/callback'],
    application_type: 'native',
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
  })
  expect(registration.status).toBeLessThan(300)
  const client = (await registration.json()) as { client_id: string }
  const verifier = 'a'.repeat(64)
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  )
  const challenge = Buffer.from(bytes).toString('base64url')
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: 'http://127.0.0.1:9100/callback',
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope:
      preset === 'manage'
        ? 'devpush:read devpush:manage devpush:logs offline_access'
        : 'devpush:read devpush:logs offline_access',
    resource: mcpResource,
    state: 'state-test',
  })
  const response = await auth.handler(
    new Request(`http://localhost:7429/api/auth/oauth2/authorize?${query}`, {
      headers: ids.headers,
    }),
  )
  const location = response.headers.get('location')
  expect(location).toContain('/oauth/consent?')
  const oauthQuery = new URL(location!, 'http://localhost:7429').search.slice(1)
  const context = await getMcpConsent({ oauthQuery, headers: ids.headers })
  expect(context?.clientName).toBe('Test assistant')
  expect(context?.redirectHost).toBe('127.0.0.1:9100')
  expect(context?.requestedPermissions).toEqual(
    preset === 'manage' ? ['read', 'manage'] : ['read'],
  )
  expect(context?.allowLogs).toBe(true)
  const result = await completeMcpConsent({
    oauthQuery,
    headers: ids.headers,
    accepted: true,
    teamId: ids.teamId,
    preset,
    includeLogs,
  })
  const callback = new URL(result.redirectUrl)
  expect(callback.searchParams.get('state')).toBe('state-test')
  expect(callback.searchParams.get('iss')).toBe(
    'http://localhost:7429/api/auth',
  )
  const tokenInput = {
    client_id: client.client_id,
    grant_type: 'authorization_code',
    code: callback.searchParams.get('code')!,
    code_verifier: verifier,
    redirect_uri: 'http://127.0.0.1:9100/callback',
    resource: mcpResource,
  }
  return { ...ids, client, tokenInput, oauthQuery }
}

describe('MCP OAuth using the maintained provider', () => {
  test('native PKCE consent binds resources, scopes and revocable user connections', async () => {
    const context = await authorize()
    const response = await oauthRequest(
      '/oauth2/token',
      context.tokenInput,
      undefined,
      true,
    )
    if (response.status !== 200)
      throw new Error(
        `Token response: ${response.status} ${await response.text()}`,
      )
    expect(response.status).toBe(200)
    const tokens = (await response.json()) as {
      access_token: string
      refresh_token: string
      scope: string
    }
    expect(tokens.scope).toBe('devpush:read offline_access')
    const principal = await authenticateMcpRequest(
      new Request(mcpResource, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    )
    expect(principal).toMatchObject({
      userId: context.userId,
      teamId: context.teamId,
      credentialKind: 'oauth',
    })
    expect(principal.scopes).not.toContain('logs:read')
    const connections = await listMcpConnections({ headers: context.headers })
    expect(connections.connections[0]).toMatchObject({
      id: principal.credentialId,
      name: 'Test assistant',
      status: 'active',
    })
    await revokeMcpConnection({
      id: principal.credentialId,
      headers: context.headers,
    })
    await expect(
      authenticateMcpRequest(
        new Request(mcpResource, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        }),
      ),
    ).rejects.toThrow()
    const refresh = await oauthRequest(
      '/oauth2/token',
      {
        client_id: context.client.client_id,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        resource: mcpResource,
      },
      undefined,
      true,
    )
    expect(refresh.status).toBe(400)
  })

  test('refresh narrowing cannot regain the stored grant write or log scopes', async () => {
    const context = await authorize('manage', true)
    const response = await oauthRequest(
      '/oauth2/token',
      context.tokenInput,
      undefined,
      true,
    )
    expect(response.status).toBe(200)
    const tokens = (await response.json()) as {
      access_token: string
      refresh_token: string
    }
    const before = await authenticateMcpRequest(
      new Request(mcpResource, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    )
    expect(before.scopes).toContain('deployments:write')
    expect(before.scopes).toContain('logs:read')
    const refreshed = await oauthRequest(
      '/oauth2/token',
      {
        client_id: context.client.client_id,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        scope: 'devpush:read',
        resource: mcpResource,
      },
      undefined,
      true,
    )
    expect(refreshed.status).toBe(200)
    const narrowed = (await refreshed.json()) as {
      access_token: string
      refresh_token: string
    }
    const after = await authenticateMcpRequest(
      new Request(mcpResource, {
        headers: { authorization: `Bearer ${narrowed.access_token}` },
      }),
    )
    expect(after.scopes).toContain('projects:read')
    expect(after.scopes).not.toContain('deployments:write')
    expect(after.scopes).not.toContain('logs:read')
    await db.run(
      sql`update user set status='banned' where id=${context.userId}`,
    )
    await expect(
      authenticateMcpRequest(
        new Request(mcpResource, {
          headers: { authorization: `Bearer ${narrowed.access_token}` },
        }),
      ),
    ).rejects.toThrow()
    await db.run(
      sql`update user set status='active' where id=${context.userId}`,
    )
    await expect(
      authenticateMcpRequest(
        new Request(mcpResource, {
          headers: { authorization: `Bearer ${narrowed.access_token}` },
        }),
      ),
    ).rejects.toThrow()
  })

  test('refresh token replay revokes the issued token family', async () => {
    const context = await authorize()
    const response = await oauthRequest(
      '/oauth2/token',
      context.tokenInput,
      undefined,
      true,
    )
    const tokens = (await response.json()) as {
      access_token: string
      refresh_token: string
    }
    const input = {
      client_id: context.client.client_id,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      resource: mcpResource,
    }
    const refreshed = await oauthRequest(
      '/oauth2/token',
      input,
      undefined,
      true,
    )
    expect(refreshed.status).toBe(200)
    const rotated = (await refreshed.json()) as {
      access_token: string
      refresh_token: string
    }
    const replay = await oauthRequest('/oauth2/token', input, undefined, true)
    expect(replay.status).toBeGreaterThanOrEqual(400)
    await expect(
      authenticateMcpRequest(
        new Request(mcpResource, {
          headers: { authorization: `Bearer ${rotated.access_token}` },
        }),
      ),
    ).rejects.toThrow()
  })

  test('official SDK negotiates stateless 2026 HTTP and calls scoped tools', async () => {
    const ids = await seed()
    const key = await createApiKey(ids.userId, {
      name: 'SDK assistant',
      teamId: ids.teamId,
      preset: 'read',
      expiresInDays: 7,
    })
    const client = new Client(
      { name: 'SDK2.3.1', version: '2.3.1' },
      { versionNegotiation: { mode: 'auto' } },
    )
    const transport = new StreamableHTTPClientTransport(new URL(mcpResource), {
      requestInit: { headers: { authorization: `Bearer ${key.secret}` } },
      fetch: (input, init) => handleMcpRequest(new Request(input, init)),
    })
    await client.connect(transport)
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
    expect(client.getServerVersion()?.name).toBe('devpush')
    const tools = await client.listTools()
    expect(tools.tools.some((tool) => tool.name === 'list_projects')).toBe(true)
    const result = await client.callTool({
      name: 'get_identity',
      arguments: {},
    })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({ user: { id: ids.userId } })
    await client.close()
  })

  test('cookie-only requests cannot access MCP; bearer keys share scoped operation tools', async () => {
    const ids = await seed()
    const cookieOnly = await handleMcpRequest(
      new Request(mcpResource, {
        method: 'POST',
        headers: ids.headers,
        body: '{}',
      }),
    )
    expect(cookieOnly.status).toBe(401)
    expect(cookieOnly.headers.get('www-authenticate')).toContain(
      'oauth-protected-resource/mcp',
    )
    const key = await createApiKey(ids.userId, {
      name: 'Assistant',
      teamId: ids.teamId,
      preset: 'read',
      expiresInDays: 7,
    })
    const headers = {
      authorization: `Bearer ${key.secret}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
    const request = (method: string, params: object) =>
      handleMcpRequest(
        new Request(mcpResource, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
      )
    const initialized = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'SDK compatibility test', version: '1' },
    })
    expect(initialized.status).toBe(200)
    const text = await initialized.text()
    expect(text).toContain('devpush')
    const listed = await request('tools/list', {})
    const tools = await listed.text()
    expect(tools).toContain('list_projects')
    expect(tools).not.toContain('"name":"deploy"')
    const identity = await request('tools/call', {
      name: 'get_identity',
      arguments: {},
    })
    expect(await identity.text()).toContain(ids.userId)
    const forbiddenOrigin = await handleMcpRequest(
      new Request(mcpResource, {
        method: 'POST',
        headers: { ...headers, origin: 'https://attacker.invalid' },
        body: '{}',
      }),
    )
    expect(forbiddenOrigin.status).toBe(403)
  })

  test('a subsequent connection from the same client requires a fresh resource choice', async () => {
    const context = await authorize()
    const query = new URLSearchParams(context.oauthQuery)
    for (const name of ['sig', 'exp', 'ba_iat', 'ba_pl', 'ba_param'])
      query.delete(name)
    const response = await auth.handler(
      new Request(`http://localhost:7429/api/auth/oauth2/authorize?${query}`, {
        headers: context.headers,
      }),
    )
    expect(response.headers.get('location')).toContain('/oauth/consent?')
  })

  test('connection pagination keeps revoked history reachable', async () => {
    const context = await seed()
    const projectId = crypto.randomUUID()
    await db.insert(projects).values({
      id: projectId,
      teamId: context.teamId,
      name: 'Historical connection project',
      slug: projectId,
      githubRepo: 'example/history',
      avatarPath: '/uploads/avatars/project_history.png',
    })
    const now = Date.now()
    await db.insert(apiGrants).values(
      Array.from({ length: 26 }, (_, index) => ({
        id: crypto.randomUUID(),
        userId: context.userId,
        teamId: context.teamId,
        membershipId: context.membershipId,
        roleCeiling: 'admin' as const,
        projectIds: index === 0 ? [projectId] : null,
        scopes: ['projects:read'],
        providerGrantId: 'pagination-client',
        expiresAt: new Date(now + 3600000),
        createdAt: new Date(now + index),
        revokedAt: index === 0 ? new Date(now) : null,
      })),
    )
    const first = await listMcpConnections({
      headers: context.headers,
      page: 1,
    })
    const second = await listMcpConnections({
      headers: context.headers,
      page: 2,
    })
    expect(first.pagination).toMatchObject({
      total: 26,
      totalPages: 2,
      pageSize: 25,
    })
    expect(first.connections).toHaveLength(25)
    expect(second.connections).toHaveLength(1)
    expect(second.connections[0]?.status).toBe('revoked')
    expect(
      first.connections.every((connection) => connection.projects === null),
    ).toBe(true)
    expect(second.connections[0]?.projects).toEqual([
      {
        id: projectId,
        name: 'Historical connection project',
        image: '/uploads/avatars/project_history.png',
        color: getResourceColor(projectId),
        available: true,
      },
    ])
    expect(
      first.connections.some(
        (connection) => connection.id === second.connections[0]?.id,
      ),
    ).toBe(false)
  })

  test('connection scopes include actual team and project avatars, names and resource colors', async () => {
    const context = await seed()
    const firstId = crypto.randomUUID(),
      secondId = crypto.randomUUID()
    await db
      .update(teams)
      .set({ avatarPath: '/uploads/avatars/team_mcp.png' })
      .where(eq(teams.id, context.teamId))
    await db.insert(projects).values([
      {
        id: firstId,
        teamId: context.teamId,
        name: 'API service',
        slug: firstId,
        githubRepo: 'example/api',
        avatarPath: '/uploads/avatars/project_api.png',
      },
      {
        id: secondId,
        teamId: context.teamId,
        name: 'Web dashboard',
        slug: secondId,
        githubRepo: 'example/web',
      },
    ])
    const allId = await seedConnection(context, null)
    const singleId = await seedConnection(context, [firstId])
    const multipleId = await seedConnection(context, [secondId, firstId])
    const result = await listMcpConnections({ headers: context.headers })
    const byId = new Map(
      result.connections.map((connection) => [connection.id, connection]),
    )
    for (const connection of result.connections) {
      expect(connection).toMatchObject({
        team: {
          id: context.teamId,
          name: 'MCP team',
          image: '/uploads/avatars/team_mcp.png',
          color: getResourceColor(context.teamId),
        },
        status: 'active',
      })
    }
    expect(byId.get(allId)?.projects).toBeNull()
    const firstProject = {
      id: firstId,
      name: 'API service',
      image: '/uploads/avatars/project_api.png',
      color: getResourceColor(firstId),
      available: true,
    }
    const secondProject = {
      id: secondId,
      name: 'Web dashboard',
      image: null,
      color: getResourceColor(secondId),
      available: true,
    }
    expect(byId.get(singleId)?.projects).toEqual([firstProject])
    expect(byId.get(multipleId)?.projects).toEqual([
      secondProject,
      firstProject,
    ])
    expect(
      byId.get(multipleId)?.projects?.map((project) => project.id),
    ).toEqual([secondId, firstId])
  })

  test('deleted, missing and cross-team project restrictions stay explicit without exposing metadata', async () => {
    const context = await seed(),
      other = await seed()
    const activeId = crypto.randomUUID(),
      deletedId = crypto.randomUUID(),
      missingId = crypto.randomUUID(),
      foreignId = crypto.randomUUID()
    await db.insert(projects).values([
      {
        id: activeId,
        teamId: context.teamId,
        name: 'Available project',
        slug: activeId,
        githubRepo: 'example/active',
      },
      {
        id: deletedId,
        teamId: context.teamId,
        name: 'Deleted project name',
        slug: deletedId,
        githubRepo: 'example/deleted',
        status: 'deleted',
        avatarPath: '/uploads/avatars/deleted_private.png',
      },
      {
        id: foreignId,
        teamId: other.teamId,
        name: 'Other team private project',
        slug: foreignId,
        githubRepo: 'example/foreign',
        avatarPath: '/uploads/avatars/foreign_private.png',
      },
    ])
    const restrictedIds = [activeId, deletedId, missingId, foreignId]
    const grantId = await seedConnection(context, restrictedIds)
    await seedConnection(other, [foreignId])
    const result = await listMcpConnections({ headers: context.headers })
    expect(result.connections).toHaveLength(1)
    const connection = result.connections[0]!
    expect(connection.id).toBe(grantId)
    expect(connection.projects?.map((project) => project.id)).toEqual(
      restrictedIds,
    )
    expect(connection.projects).toEqual([
      {
        id: activeId,
        name: 'Available project',
        image: null,
        color: getResourceColor(activeId),
        available: true,
      },
      ...[deletedId, missingId, foreignId].map((id) => ({
        id,
        name: null,
        image: null,
        color: getResourceColor(id),
        available: false,
      })),
    ])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('Deleted project name')
    expect(serialized).not.toContain('Other team private project')
    expect(serialized).not.toContain('foreign_private.png')
    expect(serialized).not.toContain('deleted_private.png')
    const [storedGrant] = await db
      .select()
      .from(apiGrants)
      .where(eq(apiGrants.id, grantId))
    expect(storedGrant?.projectIds).toEqual(restrictedIds)
    expect(storedGrant?.revokedAt).toBeNull()
  })

  test('retained historical restrictions hide current avatars and project names after membership ends', async () => {
    const context = await seed()
    const otherTeamId = crypto.randomUUID(),
      projectId = crypto.randomUUID()
    await db.batch([
      db
        .insert(teams)
        .values({ id: otherTeamId, name: 'Another team', slug: otherTeamId }),
      db
        .update(teams)
        .set({ avatarPath: '/uploads/avatars/current_team_private.png' })
        .where(eq(teams.id, context.teamId)),
      db.insert(projects).values({
        id: projectId,
        teamId: context.teamId,
        name: 'Current restricted project',
        slug: projectId,
        githubRepo: 'example/current',
        avatarPath: '/uploads/avatars/current_project_private.png',
      }),
    ])
    const grantId = await seedConnection(context, [projectId])
    await revokeApiGrant(context.userId, grantId)
    // Normally deletion cascades away grants. Simulate retained history whose
    // membership row no longer represents access to the original team.
    await db
      .update(teamMembers)
      .set({ teamId: otherTeamId })
      .where(eq(teamMembers.id, context.membershipId))
    const result = await listMcpConnections({ headers: context.headers })
    expect(result.connections).toHaveLength(1)
    expect(result.connections[0]).toMatchObject({
      id: grantId,
      status: 'revoked',
      team: {
        id: context.teamId,
        name: 'MCP team',
        image: null,
        color: getResourceColor(context.teamId),
      },
      projects: [
        {
          id: projectId,
          name: null,
          image: null,
          color: getResourceColor(projectId),
          available: false,
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('Current restricted project')
    expect(JSON.stringify(result)).not.toContain('current_project_private.png')
    expect(JSON.stringify(result)).not.toContain('current_team_private.png')
  })

  test.each(['deleted', 'banned'] as const)(
    'inactive %s teams keep restricted projects unavailable and hide avatar metadata',
    async (status) => {
      const context = await seed()
      const projectId = crypto.randomUUID()
      await db.batch([
        db
          .update(teams)
          .set({ avatarPath: '/uploads/avatars/inactive_team_private.png' })
          .where(eq(teams.id, context.teamId)),
        db.insert(projects).values({
          id: projectId,
          teamId: context.teamId,
          name: 'Inactive team private project',
          slug: projectId,
          githubRepo: 'example/inactive',
          avatarPath: '/uploads/avatars/inactive_project_private.png',
        }),
      ])
      const grantId = await seedConnection(context, [projectId])
      await db.update(teams).set({ status }).where(eq(teams.id, context.teamId))
      const result = await listMcpConnections({ headers: context.headers })
      expect(result.connections[0]).toMatchObject({
        id: grantId,
        status: 'revoked',
        team: { image: null },
        projects: [
          { id: projectId, name: null, image: null, available: false },
        ],
      })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('Inactive team private project')
      expect(serialized).not.toContain('inactive_team_private.png')
      expect(serialized).not.toContain('inactive_project_private.png')
    },
  )

  test('authorization query signatures reject tampered client scopes', async () => {
    const context = await authorize()
    await expect(
      getMcpConsent({
        oauthQuery: context.oauthQuery.replace(
          'devpush%3Aread',
          'devpush%3Amanage',
        ),
        headers: context.headers,
      }),
    ).rejects.toThrow()
    const rows = await db
      .select({ id: apiGrants.id })
      .from(apiGrants)
      .where(eq(apiGrants.userId, context.userId))
    await revokeApiGrant(context.userId, rows[0]!.id)
  })
})
