import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '#devpush/server/db'
import type { AtomicStore } from '#devpush/server/db/atomic'
import { createD1TestStores } from '#devpush/test/d1'
import { getResourceColor } from '#devpush/server/resources/color'
import {
  createApiKey,
  createApiGrant,
  getApiKeySettings,
  getApiKeyTeams,
  getApiKeyProjects,
  hashApiSecret,
  authenticateApiKey,
  resolveApiGrant,
  revokeApiKey,
  rotateApiKey,
} from './credentials'
import {
  apiAuthorizationCondition,
  requireApiProject,
  requireApiScope,
} from './authorization'

let d1: Awaited<ReturnType<typeof createD1TestStores>> | undefined
beforeAll(async () => {
  d1 = await createD1TestStores()
}, 30_000)
afterAll(async () => {
  await d1?.runtime.dispose()
})

async function seed(store: AtomicStore) {
  const prefix = crypto.randomUUID()
  const ids = {
    userId: `${prefix}-user`,
    teamId: `${prefix}-team`,
    membershipId: `${prefix}-membership`,
    projectId: `${prefix}-project`,
    otherProjectId: `${prefix}-other-project`,
    otherTeamId: `${prefix}-other-team`,
  }
  await store.batch([
    store.run(
      sql`insert into user (id,name,username,email) values (${ids.userId},'API user',${ids.userId},${`${ids.userId}@example.invalid`})`,
    ),
    store.run(
      sql`insert into teams (id,name,slug) values (${ids.teamId},'API team',${ids.teamId}),(${ids.otherTeamId},'Other team',${ids.otherTeamId})`,
    ),
    store.run(
      sql`insert into team_members (id,user_id,team_id,role) values (${ids.membershipId},${ids.userId},${ids.teamId},'admin')`,
    ),
    store.run(
      sql`insert into projects (id,name,slug,team_id,github_repo) values (${ids.projectId},'Allowed','allowed',${ids.teamId},'example/allowed'),(${ids.otherProjectId},'Other','other',${ids.otherTeamId},'example/other')`,
    ),
  ])
  return ids
}

const request = (secret: string) =>
  new Request('https://devpush.example/api/v1/projects', {
    headers: { authorization: `Bearer ${secret}` },
  })

describe.each(['SQLite', 'D1'] as const)('API credentials on %s', (target) => {
  const store = () => {
    if (target === 'SQLite') return db
    if (!d1) throw new Error('D1 test store was not initialized.')
    return d1.main
  }

  test('secrets are returned once, stored as hashes and never included in listings', async () => {
    const database = store()
    const ids = await seed(database)
    const created = await createApiKey(
      ids.userId,
      {
        name: 'CI',
        teamId: ids.teamId,
        projectIds: [ids.projectId],
        preset: 'deploy',
        expiresInDays: 7,
      },
      database,
    )
    expect(created.secret).toMatch(/^dp_[a-f0-9]{64}$/)
    const [stored] = await database.all<{ key_hash: string }>(
      sql`select key_hash from api_keys where id = ${created.key.id}`,
    )
    const keyHash = Array.isArray(stored)
      ? (stored[0] as string)
      : stored?.key_hash
    expect(keyHash).toBe(await hashApiSecret(created.secret))
    const settings = await getApiKeySettings(ids.userId, database)
    expect(JSON.stringify(settings)).not.toContain(created.secret)
    expect(JSON.stringify(settings)).not.toContain(keyHash)
    expect(settings.keys[0]).toMatchObject({
      status: 'active',
      prefix: created.secret.slice(0, 11),
    })
    const principal = await authenticateApiKey(
      request(created.secret),
      database,
    )
    expect(principal.membershipId).toBe(ids.membershipId)
    requireApiScope(principal, 'deployments:write')
    requireApiProject(principal, ids.projectId)
    expect(() => requireApiScope(principal, 'logs:read')).toThrow()
    expect(() => requireApiProject(principal, ids.otherProjectId)).toThrow()
    expect(
      await database.all(
        sql`select 1 where ${apiAuthorizationCondition(principal, { scope: 'deployments:write', projectId: ids.otherProjectId })}`,
      ),
    ).toHaveLength(0)
  })

  test('never-expiring keys store null, remain active and rotate without gaining an expiry', async () => {
    const database = store()
    const ids = await seed(database)
    const created = await createApiKey(
      ids.userId,
      { name: 'Permanent CI', teamId: ids.teamId, expiresInDays: null },
      database,
    )
    expect(created.key).toMatchObject({ expiresAt: null, status: 'active' })
    expect(
      await database.all(
        sql`select id from api_keys where id = ${created.key.id} and expires_at is null`,
      ),
    ).toHaveLength(1)
    const principal = await authenticateApiKey(
      request(created.secret),
      database,
    )
    const guard = apiAuthorizationCondition(principal, {
      scope: 'projects:read',
      projectId: ids.projectId,
    })
    expect(await database.all(sql`select 1 where ${guard}`)).toHaveLength(1)
    const rotated = await rotateApiKey(ids.userId, created.key.id, database)
    expect(rotated.key).toMatchObject({ expiresAt: null, status: 'active' })
    await expect(
      authenticateApiKey(request(created.secret), database),
    ).rejects.toThrow()
    const rotatedPrincipal = await authenticateApiKey(
      request(rotated.secret),
      database,
    )
    const rotatedGuard = apiAuthorizationCondition(rotatedPrincipal)
    await revokeApiKey(ids.userId, rotated.key.id, database)
    expect(
      await database.all(sql`select 1 where ${rotatedGuard}`),
    ).toHaveLength(0)
    await expect(
      authenticateApiKey(request(rotated.secret), database),
    ).rejects.toThrow()
    const settings = await getApiKeySettings(ids.userId, database)
    expect(settings.keys).toHaveLength(2)
    expect(
      settings.keys.every(
        (key) => key.expiresAt === null && key.status === 'revoked',
      ),
    ).toBe(true)
  })

  test.each([1, 180, 365])(
    'finite %s-day keys preserve their chosen lifetime when rotated',
    async (days) => {
      const database = store()
      const ids = await seed(database)
      const created = await createApiKey(
        ids.userId,
        { name: 'Finite CI', teamId: ids.teamId, expiresInDays: days },
        database,
      )
      expect(created.key.status).toBe('active')
      expect(created.key.expiresAt).not.toBeNull()
      expect(
        Date.parse(created.key.expiresAt!) - Date.parse(created.key.createdAt),
      ).toBe(days * 86_400_000)
      const rotated = await rotateApiKey(ids.userId, created.key.id, database)
      expect(rotated.key.expiresAt).not.toBeNull()
      expect(
        Date.parse(rotated.key.expiresAt!) - Date.parse(rotated.key.createdAt),
      ).toBe(days * 86_400_000)
      await expect(
        authenticateApiKey(request(rotated.secret), database),
      ).resolves.toMatchObject({ credentialId: rotated.key.id })
    },
  )

  test('never-expiring keys count toward the active cap, including rotation at the cap', async () => {
    const database = store()
    const ids = await seed(database)
    const created = await createApiKey(
      ids.userId,
      { name: 'Permanent CI', teamId: ids.teamId, expiresInDays: null },
      database,
    )
    await database.run(sql`insert into api_keys(id,user_id,team_id,membership_id,name,prefix,key_hash,role_ceiling,preset,scopes,expires_at)
      with recursive sequence(value) as (values(1) union all select value + 1 from sequence where value < 99)
      select ${`${ids.userId}-permanent-`} || value,${ids.userId},${ids.teamId},${ids.membershipId},'Permanent','dp_test',${`${ids.userId}-hash-`} || value,'member','read','[]',null from sequence`)
    for (const expiresInDays of [365, null]) {
      await expect(
        createApiKey(
          ids.userId,
          { name: 'Over limit', teamId: ids.teamId, expiresInDays },
          database,
        ),
      ).rejects.toMatchObject({ code: 'API_KEY_CREATION_UNAVAILABLE' })
    }
    const rotated = await rotateApiKey(ids.userId, created.key.id, database)
    expect(rotated.key.expiresAt).toBeNull()
    expect(
      await database.all(
        sql`select id from api_keys where user_id = ${ids.userId} and revoked_at is null and expires_at is null`,
      ),
    ).toHaveLength(100)
    await revokeApiKey(ids.userId, `${ids.userId}-permanent-1`, database)
    await expect(
      createApiKey(
        ids.userId,
        { name: 'New finite key', teamId: ids.teamId, expiresInDays: 365 },
        database,
      ),
    ).resolves.toHaveProperty('secret')
  })

  test('OAuth grants retain finite expiry and cannot inherit never-expiring key behavior', async () => {
    const database = store()
    const ids = await seed(database)
    const grant = await createApiGrant(
      {
        userId: ids.userId,
        teamId: ids.teamId,
        projectIds: null,
        preset: 'read',
        expiresInDays: 30,
      },
      database,
    )
    expect(
      await database.all(
        sql`select id from api_grants where id = ${grant.credentialId} and expires_at - created_at = ${30 * 86_400_000}`,
      ),
    ).toHaveLength(1)
    await expect(
      database.run(
        sql`update api_grants set expires_at = null where id = ${grant.credentialId}`,
      ),
    ).rejects.toThrow()
    const guard = apiAuthorizationCondition(grant)
    await database.run(
      sql`update api_grants set expires_at = 1 where id = ${grant.credentialId}`,
    )
    expect(await database.all(sql`select 1 where ${guard}`)).toHaveLength(0)
    await expect(
      resolveApiGrant(grant.credentialId, database),
    ).rejects.toThrow()
  })

  test('cookie sessions, revoked keys and keys with foreign projects are rejected', async () => {
    const database = store()
    const ids = await seed(database)
    await expect(
      authenticateApiKey(
        new Request('https://devpush.example/api/v1/projects', {
          headers: { cookie: 'better-auth.session_token=browser' },
        }),
        database,
      ),
    ).rejects.toThrow()
    await expect(
      createApiKey(
        ids.userId,
        { name: 'Wrong team', teamId: ids.otherTeamId },
        database,
      ),
    ).rejects.toThrow()
    await expect(
      createApiKey(
        ids.userId,
        {
          name: 'Wrong project',
          teamId: ids.teamId,
          projectIds: [ids.otherProjectId],
        },
        database,
      ),
    ).rejects.toThrow()
    const created = await createApiKey(
      ids.userId,
      { name: 'CI', teamId: ids.teamId },
      database,
    )
    await revokeApiKey(ids.userId, created.key.id, database)
    await expect(
      authenticateApiKey(request(created.secret), database),
    ).rejects.toThrow()
  })

  test('current role clamps scopes and final admission blocks revoked or demoted actors', async () => {
    const database = store()
    const ids = await seed(database)
    const created = await createApiKey(
      ids.userId,
      { name: 'Manage', teamId: ids.teamId, preset: 'manage' },
      database,
    )
    const principal = await authenticateApiKey(
      request(created.secret),
      database,
    )
    requireApiScope(principal, 'servers:write')
    await database.run(
      sql`update team_members set role = 'member' where id = ${ids.membershipId}`,
    )
    expect(
      await database.all(
        sql`select 1 where ${apiAuthorizationCondition(principal, { scope: 'servers:write' })}`,
      ),
    ).toHaveLength(0)
    const demoted = await authenticateApiKey(request(created.secret), database)
    expect(demoted.roleCeiling).toBe('member')
    expect(() => requireApiScope(demoted, 'servers:write')).toThrow()
    requireApiScope(demoted, 'projects:write')
    await revokeApiKey(ids.userId, created.key.id, database)
    const mutated =
      await database.all(sql`update projects set name = 'should not change' where id = ${ids.projectId}
      and ${apiAuthorizationCondition(principal, { scope: 'projects:write', projectId: ids.projectId })} returning id`)
    expect(mutated).toHaveLength(0)
  })

  test('ban and unban permanently revoke both API keys and OAuth grants', async () => {
    const database = store()
    const ids = await seed(database)
    const key = await createApiKey(
      ids.userId,
      { name: 'CI', teamId: ids.teamId },
      database,
    )
    const grant = await createApiGrant(
      {
        userId: ids.userId,
        teamId: ids.teamId,
        projectIds: null,
        preset: 'read',
        expiresInDays: 7,
        providerGrantId: 'mcp-client',
      },
      database,
    )
    expect(grant.providerGrantId).toBe('mcp-client')
    await database.run(
      sql`update user set status = 'banned' where id = ${ids.userId}`,
    )
    await database.run(
      sql`update user set status = 'active' where id = ${ids.userId}`,
    )
    await expect(
      authenticateApiKey(request(key.secret), database),
    ).rejects.toThrow()
    await expect(
      resolveApiGrant(grant.credentialId, database),
    ).rejects.toThrow()
    expect(
      (await getApiKeySettings(ids.userId, database)).keys[0]?.status,
    ).toBe('revoked')
  })

  test('membership removal and rejoin cannot revive old credentials', async () => {
    const database = store()
    const ids = await seed(database)
    const key = await createApiKey(
      ids.userId,
      { name: 'CI', teamId: ids.teamId },
      database,
    )
    await database.run(
      sql`delete from team_members where id = ${ids.membershipId}`,
    )
    await database.run(
      sql`insert into team_members(id,user_id,team_id,role) values (${crypto.randomUUID()},${ids.userId},${ids.teamId},'admin')`,
    )
    await expect(
      authenticateApiKey(request(key.secret), database),
    ).rejects.toThrow()
  })

  test('rotation is atomic, narrows to current role and invalidates the old secret', async () => {
    const database = store()
    const ids = await seed(database)
    const key = await createApiKey(
      ids.userId,
      { name: 'CI', teamId: ids.teamId, preset: 'manage', includeLogs: true },
      database,
    )
    await database.run(
      sql`update team_members set role = 'member' where id = ${ids.membershipId}`,
    )
    const rotated = await rotateApiKey(ids.userId, key.key.id, database)
    expect(rotated.secret).not.toBe(key.secret)
    await expect(
      authenticateApiKey(request(key.secret), database),
    ).rejects.toThrow()
    const principal = await authenticateApiKey(
      request(rotated.secret),
      database,
    )
    requireApiScope(principal, 'logs:read')
    expect(() => requireApiScope(principal, 'servers:write')).toThrow()
    await expect(
      rotateApiKey(ids.userId, key.key.id, database),
    ).rejects.toThrow()
    expect(
      (await getApiKeySettings(ids.userId, database)).keys.filter(
        (entry) => entry.status === 'active',
      ),
    ).toHaveLength(1)
  })

  test('key history and scope discovery are paginated without losing later records', async () => {
    const database = store()
    const ids = await seed(database)
    const now = Date.now()
    for (let index = 0; index < 27; index++) {
      await database.run(sql`insert into api_keys(id,user_id,team_id,membership_id,name,prefix,key_hash,role_ceiling,preset,scopes,expires_at,created_at)
        values (${`${ids.userId}-${index}`},${ids.userId},${ids.teamId},${ids.membershipId},${`Key ${index}`},'dp_fixture',${`${ids.userId}-hash-${index}`},'member','read','[]',${now + 60000},${now + index})`)
      await database.run(
        sql`insert into projects(id,name,slug,team_id,github_repo) values (${`${ids.userId}-project-${index}`},${`Project ${String(index).padStart(2, '0')}`},${`project-${index}`},${ids.teamId},'example/project')`,
      )
    }
    const first = await getApiKeySettings(ids.userId, database)
    const second = await getApiKeySettings(ids.userId, database, { page: 2 })
    expect(first.keys).toHaveLength(25)
    expect(second.keys).toHaveLength(2)
    expect(first.pagination).toMatchObject({
      total: 27,
      totalPages: 2,
      page: 1,
    })
    expect(
      new Set([...first.keys, ...second.keys].map((key) => key.id)).size,
    ).toBe(27)
    expect(first.teams[0]?.projects).toEqual([])
    const scopes = await getApiKeyProjects(
      ids.userId,
      { teamId: ids.teamId, query: 'Project 26' },
      database,
    )
    expect(scopes.items).toHaveLength(1)
    expect(scopes.items[0]?.name).toBe('Project 26')
    expect(
      (await getApiKeyTeams(ids.userId, { query: 'API team' }, database)).items,
    ).toHaveLength(1)
    expect(
      (await getApiKeyTeams(ids.userId, { query: '%' }, database)).items,
    ).toHaveLength(0)
    await expect(
      getApiKeyProjects(ids.userId, { teamId: ids.otherTeamId }, database),
    ).rejects.toThrow()
  })

  test('a failed rotation rolls back issuance and leaves the original key valid', async () => {
    const database = store()
    const ids = await seed(database)
    const key = await createApiKey(
      ids.userId,
      { name: 'RejectRotation', teamId: ids.teamId },
      database,
    )
    await database.run(sql`create trigger reject_api_rotation before update of revoked_at on api_keys
      when old.name = 'RejectRotation' begin select raise(abort,'simulated rotation failure'); end`)
    try {
      await expect(
        rotateApiKey(ids.userId, key.key.id, database),
      ).rejects.toThrow()
      const settings = await getApiKeySettings(ids.userId, database)
      expect(settings.keys).toHaveLength(1)
      expect(settings.keys[0]?.status).toBe('active')
      await expect(
        authenticateApiKey(request(key.secret), database),
      ).resolves.toMatchObject({ credentialId: key.key.id })
    } finally {
      await database.run(sql`drop trigger reject_api_rotation`)
    }
  })

  test('expired and inactive-team credentials cannot pass a previously built admission guard', async () => {
    const database = store()
    const ids = await seed(database)
    const key = await createApiKey(
      ids.userId,
      { name: 'CI', teamId: ids.teamId },
      database,
    )
    const principal = await authenticateApiKey(request(key.secret), database)
    const guard = apiAuthorizationCondition(principal, {
      scope: 'projects:read',
      projectId: ids.projectId,
    })
    await database.run(
      sql`update api_keys set expires_at = 1 where id = ${key.key.id}`,
    )
    expect(await database.all(sql`select 1 where ${guard}`)).toHaveLength(0)
    await database.run(
      sql`update api_keys set expires_at = ${Date.now() + 60000} where id = ${key.key.id}`,
    )
    await database.run(
      sql`update teams set status = 'deleted' where id = ${ids.teamId}`,
    )
    await database.run(
      sql`update teams set status = 'active' where id = ${ids.teamId}`,
    )
    expect(await database.all(sql`select 1 where ${guard}`)).toHaveLength(0)
    await expect(
      authenticateApiKey(request(key.secret), database),
    ).rejects.toThrow()
  })

  test('active connection and key caps are enforced during issuance and revoked records free capacity', async () => {
    const database = store()
    const ids = await seed(database)
    const expiresAt = Date.now() + 60000
    await database.run(sql`insert into api_grants(id,user_id,team_id,membership_id,role_ceiling,scopes,expires_at)
      with recursive sequence(value) as (values(1) union all select value + 1 from sequence where value < 100)
      select ${`${ids.userId}-grant-`} || value,${ids.userId},${ids.teamId},${ids.membershipId},'member','[]',${expiresAt} from sequence`)
    await expect(
      createApiGrant(
        {
          userId: ids.userId,
          teamId: ids.teamId,
          projectIds: null,
          preset: 'read',
          expiresInDays: 7,
        },
        database,
      ),
    ).rejects.toMatchObject({ code: 'MCP_CONNECTION_CREATION_UNAVAILABLE' })
    await database.run(
      sql`update api_grants set revoked_at = ${Date.now()} where id = ${`${ids.userId}-grant-1`}`,
    )
    await expect(
      createApiGrant(
        {
          userId: ids.userId,
          teamId: ids.teamId,
          projectIds: null,
          preset: 'read',
          expiresInDays: 7,
        },
        database,
      ),
    ).resolves.toMatchObject({ teamId: ids.teamId })
    await database.run(sql`insert into api_keys(id,user_id,team_id,membership_id,name,prefix,key_hash,role_ceiling,preset,scopes,expires_at)
      with recursive sequence(value) as (values(1) union all select value + 1 from sequence where value < 100)
      select ${`${ids.userId}-key-`} || value,${ids.userId},${ids.teamId},${ids.membershipId},'CI','dp_test',${`${ids.userId}-hash-`} || value,'member','read','[]',${expiresAt} from sequence`)
    await expect(
      createApiKey(
        ids.userId,
        { name: 'Over limit', teamId: ids.teamId },
        database,
      ),
    ).rejects.toMatchObject({ code: 'API_KEY_CREATION_UNAVAILABLE' })
    await revokeApiKey(ids.userId, `${ids.userId}-key-1`, database)
    await expect(
      createApiKey(
        ids.userId,
        { name: 'New key', teamId: ids.teamId },
        database,
      ),
    ).resolves.toHaveProperty('secret')
  })

  test('an expired key cannot rotate around the 100-active-key account cap', async () => {
    const database = store()
    const ids = await seed(database)
    const old = await createApiKey(
      ids.userId,
      { name: 'Expired key', teamId: ids.teamId },
      database,
    )
    await database.run(
      sql`update api_keys set expires_at = 1 where id = ${old.key.id}`,
    )
    await database.run(sql`insert into api_keys(id,user_id,team_id,membership_id,name,prefix,key_hash,role_ceiling,preset,scopes,expires_at)
      with recursive sequence(value) as (values(1) union all select value + 1 from sequence where value < 100)
      select ${`${ids.userId}-key-`} || value,${ids.userId},${ids.teamId},${ids.membershipId},'CI','dp_test',${`${ids.userId}-hash-`} || value,'member','read','[]',${Date.now() + 60000} from sequence`)
    await expect(
      rotateApiKey(ids.userId, old.key.id, database),
    ).rejects.toMatchObject({ code: 'API_KEY_EXPIRED' })
    const settings = await getApiKeySettings(ids.userId, database)
    expect(settings.pagination.total).toBe(101)
    expect(settings.keys.every((key) => key.status === 'active')).toBe(true)
  })

  test('paged scope options reuse uploaded avatars and stable fallback colors', async () => {
    const database = store()
    const ids = await seed(database)
    const initialTeams = await getApiKeyTeams(ids.userId, {}, database)
    const initialProjects = await getApiKeyProjects(
      ids.userId,
      { teamId: ids.teamId },
      database,
    )
    expect(initialTeams.items[0]).toMatchObject({
      id: ids.teamId,
      image: null,
      color: getResourceColor(ids.teamId),
    })
    expect(initialProjects.items[0]).toMatchObject({
      id: ids.projectId,
      avatarUrl: null,
      color: getResourceColor(ids.projectId),
    })
    await database.run(
      sql`update teams set avatar_path = '/api/uploads/team-test.webp' where id = ${ids.teamId}`,
    )
    await database.run(
      sql`update projects set avatar_path = '/api/uploads/project-test.webp' where id = ${ids.projectId}`,
    )
    const teamsWithAvatars = await getApiKeyTeams(
      ids.userId,
      { query: 'API team' },
      database,
    )
    const projectsWithAvatars = await getApiKeyProjects(
      ids.userId,
      { teamId: ids.teamId, query: 'Allowed' },
      database,
    )
    expect(teamsWithAvatars.items[0]).toMatchObject({
      id: ids.teamId,
      image: '/api/uploads/team-test.webp',
      color: getResourceColor(ids.teamId),
    })
    expect(projectsWithAvatars.items[0]).toMatchObject({
      id: ids.projectId,
      avatarUrl: '/api/uploads/project-test.webp',
      color: getResourceColor(ids.projectId),
    })
    expect(
      (await getApiKeySettings(ids.userId, database)).teams[0],
    ).toMatchObject({
      image: '/api/uploads/team-test.webp',
      color: getResourceColor(ids.teamId),
      projects: [],
    })
  })

  test('rotation rechecks expiration at final SQL admission after reading an active key', async () => {
    const database = store()
    const ids = await seed(database)
    const old = await createApiKey(
      ids.userId,
      { name: 'Expiring key', teamId: ids.teamId },
      database,
    )
    const racingStore: AtomicStore = {
      all: database.all.bind(database),
      run: database.run.bind(database),
      async batch(queries) {
        await database.run(
          sql`update api_keys set expires_at = 1 where id = ${old.key.id}`,
        )
        return database.batch(queries)
      },
    }
    await expect(
      rotateApiKey(ids.userId, old.key.id, racingStore),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const settings = await getApiKeySettings(ids.userId, database)
    expect(settings.pagination.total).toBe(1)
    expect(settings.keys[0]).toMatchObject({
      id: old.key.id,
      status: 'expired',
      revokedAt: null,
    })
  })
})
