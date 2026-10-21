import { eq } from 'drizzle-orm'
import { afterAll, expect, test } from 'vitest'
import { closeDb, db } from '@/server/db'
import {
  servers,
  user,
  teamMembers,
  teams,
  projects,
  environments,
  aliases,
} from '@/server/db/schema'
import { deploymentContext } from './server-context'

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
  await db
    .insert(user)
    .values({
      id: 'extension-owner',
      name: 'Owner',
      username: 'extension-owner',
      email: 'extension@example.test',
      emailVerified: true,
    })
  await db
    .insert(teamMembers)
    .values({
      id: 'extension-membership',
      teamId: 'extension-team',
      userId: 'extension-owner',
      role: 'owner',
    })
  expect(await deploymentContext.readWorkspace!('extension-team')).toEqual({
    id: 'extension-team',
    name: 'Team',
    slug: 'extension-team',
    status: 'active',
    serverCount: 1,
    memberCount: 1,
  })
  expect(
    await deploymentContext.authorizeWorkspace!(
      'extension-owner',
      'extension-team',
    ),
  ).toMatchObject({ id: 'extension-team', role: 'owner' })
  expect(
    await deploymentContext.authorizeWorkspace!('stranger', 'extension-team'),
  ).toBeNull()
  expect(await deploymentContext.readWorkspace!('missing')).toBeNull()
  const first = await deploymentContext.readServer('extension-a')
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
  expect(await deploymentContext.readServer('missing')).toBeNull()
  expect(await deploymentContext.hasServerRouting('extension-a')).toBe(false)
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
  expect(await deploymentContext.hasServerRouting('extension-a')).toBe(true)
  await db.delete(aliases).where(eq(aliases.id, 'retained-alias'))
  expect(await deploymentContext.hasServerRouting('extension-a')).toBe(false)
  expect((await deploymentContext.listServers({ limit: 1 }))[0]?.id).toBe(
    'extension-a',
  )
  expect(
    await deploymentContext.listServers({ afterId: 'extension-a', limit: 1 }),
  ).toMatchObject([{ id: 'extension-b', status: 'deleted' }])
  await expect(deploymentContext.listServers({ limit: 101 })).rejects.toThrow(
    'page size',
  )
})
