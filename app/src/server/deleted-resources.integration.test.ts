import { mockObjectStore } from '@/test/object-store'
import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '@/server/db'
import {
  agentJobs,
  backupArtifacts,
  backupRuns,
  environments,
  projects,
  servers,
  teams,
  user,
  userCleanupJobs,
  apiAudit,
} from '@/server/db/schema'
import {
  deletedResourceRetentionMs,
  pruneDeletedResources,
} from './deleted-resources'

const teamIds: string[] = []
const userIds: string[] = []
const auditIds: string[] = []
const now = new Date()
const old = new Date(now.getTime() - deletedResourceRetentionMs - 1000)

afterEach(async () => {
  vi.restoreAllMocks()
  for (const id of teamIds.splice(0)) {
    const rows = await db
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.teamId, id))
    for (const server of rows)
      await db.delete(agentJobs).where(eq(agentJobs.serverId, server.id))
    await db.delete(projects).where(eq(projects.teamId, id))
    await db.delete(servers).where(eq(servers.teamId, id))
    await db.delete(teams).where(eq(teams.id, id))
  }
  for (const id of userIds.splice(0))
    await db.delete(user).where(eq(user.id, id))
  for (const id of auditIds.splice(0))
    await db.delete(apiAudit).where(eq(apiAudit.id, id))
})
afterAll(closeDb)

async function fixture() {
  const teamId = crypto.randomUUID(),
    projectId = crypto.randomUUID(),
    serverId = crypto.randomUUID(),
    environmentId = crypto.randomUUID()
  teamIds.push(teamId)
  await db.insert(teams).values({
    id: teamId,
    name: 'Deleted team',
    slug: teamId,
    status: 'deleted',
    updatedAt: old,
  })
  await db.insert(servers).values({
    id: serverId,
    teamId,
    name: 'Deleted server',
    handle: serverId,
    status: 'deleted',
    updatedAt: old,
  })
  await db.insert(projects).values({
    id: projectId,
    teamId,
    name: 'Deleted project',
    slug: projectId,
    githubRepo: 'owner/repo',
    status: 'deleted',
    updatedAt: old,
    defaultServerId: serverId,
  })
  await db.insert(environments).values({
    id: environmentId,
    projectId,
    name: 'Production',
    slug: 'production',
    branch: 'main',
    runtimeId: `dp_${environmentId}`,
    status: 'deleted',
  })
  return { teamId, projectId, serverId, environmentId }
}

test('removes resolved resource trees, but preserves audit history', async () => {
  const f = await fixture()
  await db.insert(agentJobs).values({
    id: crypto.randomUUID(),
    type: 'purge',
    serverId: f.serverId,
    teamId: f.teamId,
    projectId: f.projectId,
    payload: {},
    status: 'succeeded',
    attempt: 2,
    finishedAt: old,
    updatedAt: old,
  })
  const auditId = crypto.randomUUID()
  auditIds.push(auditId)
  await db.insert(apiAudit).values({
    id: auditId,
    userId: 'former-user',
    teamId: f.teamId,
    operation: 'project.delete',
    resourceId: f.projectId,
    credentialId: 'former-key',
    requestId: crypto.randomUUID(),
    outcome: 'succeeded',
  })
  expect(await pruneDeletedResources({ now })).toEqual({
    projects: 1,
    servers: 1,
    teams: 1,
    users: 0,
  })
  expect(
    await db
      .select()
      .from(environments)
      .where(eq(environments.id, f.environmentId)),
  ).toEqual([])
  expect(
    await db.select().from(apiAudit).where(eq(apiAudit.id, auditId)),
  ).toHaveLength(1)
})

test.each(['queued', 'running', 'abandoned', 'failed', 'canceled'] as const)(
  'retains recovery data for %s attempted cleanup',
  async (status) => {
    const f = await fixture()
    await db.insert(agentJobs).values({
      id: crypto.randomUUID(),
      type: 'purge',
      serverId: f.serverId,
      teamId: f.teamId,
      payload: {},
      status,
      attempt: 1,
      finishedAt: old,
      updatedAt: old,
    })
    expect(await pruneDeletedResources({ now })).toEqual({
      projects: 0,
      servers: 0,
      teams: 0,
      users: 0,
    })
  },
)

test('retains archives and retained runtime ownership', async () => {
  const f = await fixture()
  await db
    .update(environments)
    .set({ status: 'active' })
    .where(eq(environments.id, f.environmentId))
  expect((await pruneDeletedResources({ now })).projects).toBe(0)
  await db
    .update(environments)
    .set({ status: 'deleted' })
    .where(eq(environments.id, f.environmentId))
  const runId = crypto.randomUUID()
  await db.insert(backupRuns).values({
    id: runId,
    projectId: f.projectId,
    environmentId: f.environmentId,
    serverId: f.serverId,
    runtimeId: 'dp_test',
    status: 'succeeded',
  })
  await db.insert(backupArtifacts).values({
    id: crypto.randomUUID(),
    backupRunId: runId,
    type: 'volume',
    storage: 'remote',
    objectKey: 'keep-this',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 1,
  })
  expect((await pruneDeletedResources({ now })).projects).toBe(0)
})

test('waits for acknowledgement retention after successful cleanup', async () => {
  const f = await fixture()
  await db.insert(agentJobs).values({
    id: crypto.randomUUID(),
    type: 'purge',
    serverId: f.serverId,
    projectId: f.projectId,
    payload: {},
    status: 'succeeded',
    attempt: 1,
    finishedAt: now,
    updatedAt: now,
  })
  expect((await pruneDeletedResources({ now })).projects).toBe(0)
})

test('removes a cleaned-up deleted user without deleting surviving team settings', async () => {
  const f = await fixture()
  await db.update(teams).set({ status: 'active' }).where(eq(teams.id, f.teamId))
  await db
    .update(projects)
    .set({ status: 'active' })
    .where(eq(projects.id, f.projectId))
  const userId = crypto.randomUUID()
  userIds.push(userId)
  await db.insert(user).values({
    id: userId,
    name: 'Deleted user',
    username: userId,
    email: `${userId}@example.test`,
    status: 'deleted',
    updatedAt: old,
  })
  await db.insert(userCleanupJobs).values({
    id: crypto.randomUUID(),
    userId,
    payload: {},
    status: 'succeeded',
    finishedAt: old,
  })
  expect((await pruneDeletedResources({ now })).users).toBe(1)
  expect(
    await db.select().from(projects).where(eq(projects.id, f.projectId)),
  ).toHaveLength(1)
  expect(
    await db.select().from(teams).where(eq(teams.id, f.teamId)),
  ).toHaveLength(1)
})

test('storage errors preserve the avatar reference for the next cleanup sweep', async () => {
  const f = await fixture()
  const path = `/uploads/avatars/project_${f.projectId}.png`
  await db
    .update(projects)
    .set({ avatarPath: path, updatedAt: old })
    .where(eq(projects.id, f.projectId))
  const objects = mockObjectStore([
    [path.slice('/uploads/'.length), Buffer.from('test')],
  ])
  objects.remove.mockRejectedValueOnce(new Error('Storage unavailable'))
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect((await pruneDeletedResources({ now })).projects).toBe(0)
  expect(
    (await db.select().from(projects).where(eq(projects.id, f.projectId)))[0]
      ?.avatarPath,
  ).toBe(path)
  expect((await pruneDeletedResources({ now })).projects).toBe(1)
  expect(objects.objects.size).toBe(0)
  expect(errors).toHaveBeenCalledOnce()
})

test('canceling a cleanup before its first attempt does not prove containers were removed', async () => {
  const f = await fixture()
  await db
    .insert(agentJobs)
    .values({
      id: crypto.randomUUID(),
      type: 'purge',
      serverId: f.serverId,
      projectId: f.projectId,
      payload: {},
      status: 'canceled',
      attempt: 0,
      finishedAt: old,
      updatedAt: old,
    })
  expect((await pruneDeletedResources({ now })).projects).toBe(0)
})
