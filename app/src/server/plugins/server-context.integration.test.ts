import { eq } from 'drizzle-orm'
import { afterAll, expect, test } from 'vitest'
import { closeDb, db } from '#devpush/server/db'
import {
  servers,
  user,
  teamMembers,
  teams,
  projects,
  environments,
  aliases,
} from '#devpush/server/db/schema'
import { pluginContext } from './server-context'
import { getResourceColor } from '#devpush/server/resources/color'

afterAll(closeDb)

test('exposes only routing state, paginates and retains deleted state for reconciliation', async () => {
  await db
    .insert(teams)
    .values({ id: 'extension-team', name: 'Team', slug: 'extension-team' })
  await db.insert(servers).values([
    {
      id: 'extension-a',
      teamId: 'extension-team',
      name: 'A',
      handle: 'a',
      status: 'connected',
      publicAddress: '192.0.2.1',
      agentCredentialHash: 'never-expose',
      enrollmentTokenHash: 'never-expose-either',
    },
    {
      id: 'extension-b',
      teamId: 'extension-team',
      name: 'B',
      handle: 'b',
      status: 'deleted',
    },
  ])
  await db.insert(user).values({
    id: 'extension-owner',
    name: 'Owner',
    username: 'extension-owner',
    email: 'extension@example.test',
    emailVerified: true,
  })
  await db.insert(teamMembers).values({
    id: 'extension-membership',
    teamId: 'extension-team',
    userId: 'extension-owner',
    role: 'owner',
  })
  expect(await pluginContext.readWorkspace!('extension-team')).toEqual({
    id: 'extension-team',
    personalOwnerId: null,
    createdAt: expect.any(Number),
    name: 'Team',
    image: null,
    color: getResourceColor('extension-team'),
    slug: 'extension-team',
    status: 'active',
    serverCount: 1,
    serverCountChangedAt: expect.any(Number),
    memberCount: 1,
  })
  expect(
    await pluginContext.authorizeWorkspace!(
      'extension-owner',
      'extension-team',
    ),
  ).toMatchObject({ id: 'extension-team', role: 'owner' })
  expect(
    await pluginContext.authorizeWorkspace!('stranger', 'extension-team'),
  ).toBeNull()
  expect(await pluginContext.readWorkspace!('missing')).toBeNull()
  await db
    .update(user)
    .set({ defaultTeamId: 'extension-team' })
    .where(eq(user.id, 'extension-owner'))
  expect(
    (await pluginContext.readWorkspace!('extension-team'))?.personalOwnerId,
  ).toBe('extension-owner')
  const first = await pluginContext.readServer('extension-a')
  expect(first).toEqual({
    id: 'extension-a',
    teamId: 'extension-team',
    teamSlug: 'extension-team',
    teamStatus: 'active',
    handle: 'a',
    status: 'connected',
    publicAddress: '192.0.2.1',
    publicIpv4: null,
    publicIpv6: null,
    agentCapabilities: null,
  })
  expect(await pluginContext.readServer('missing')).toBeNull()
  expect(await pluginContext.hasServerRouting('extension-a')).toBe(false)
  await db.insert(projects).values({
    id: 'routing-project',
    teamId: 'extension-team',
    name: 'routing',
    slug: 'routing',
    githubRepo: 'owner/repo',
    defaultServerId: 'extension-a',
    status: 'deleted',
  })
  await db.insert(environments).values({
    id: 'routing-environment',
    projectId: 'routing-project',
    name: 'Production',
    slug: 'production',
    branch: 'main',
    position: 0,
    runtimeId: 'dp_routing',
  })
  await db.insert(aliases).values({
    id: 'retained-alias',
    projectId: 'routing-project',
    environmentId: 'routing-environment',
    hostname: 'retained.example.test',
    type: 'environment',
  })
  expect(await pluginContext.hasServerRouting('extension-a')).toBe(true)
  await db.delete(aliases).where(eq(aliases.id, 'retained-alias'))
  expect(await pluginContext.hasServerRouting('extension-a')).toBe(false)
  expect((await pluginContext.listServers({ limit: 1 }))[0]?.id).toBe(
    'extension-a',
  )
  expect(
    await pluginContext.listServers({ afterId: 'extension-a', limit: 1 }),
  ).toMatchObject([{ id: 'extension-b', status: 'deleted' }])
  await expect(pluginContext.listServers({ limit: 101 })).rejects.toThrow(
    'page size',
  )
})
