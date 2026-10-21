import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, expect, test, vi } from 'vitest'
import { db, logsDb, closeDb } from '@/server/db'
import { operationLogs } from '@/server/db/log-schema'
import {
  agentJobs,
  projects,
  servers,
  teams,
  teamMembers,
  user,
} from '@/server/db/schema'
import { readOperationLogs, uploadOperationLogs } from './operations'
import { pruneExpiredRuntimeLogs } from './retention'

const session = vi.hoisted(() => vi.fn())
vi.mock('@/server/auth/better-auth', () => ({ auth: { api: { getSession: session } } }))
afterAll(closeDb)
test('deduplicates uploads, guards identity and reads persisted output with workspace permission even offline', async () => {
  const id = crypto.randomUUID(),
    token = 'token-' + id
  await db
    .insert(user)
    .values({ id, name: 'Logs', email: id + '@example.com', username: id })
  await db.insert(teams).values({ id, name: 'Logs', slug: id })
  await db
    .insert(teamMembers)
    .values({ id, teamId: id, userId: id, role: 'member' })
  await db.insert(servers).values({
    id,
    teamId: id,
    name: 'Logs',
    handle: id,
    status: 'connected',
    agentCredentialHash: createHash('sha256').update(token).digest('hex'),
  })
  await db
    .insert(projects)
    .values({ id, teamId: id, name: 'Logs', slug: id, githubRepo: 'test/logs' })
  await db.insert(agentJobs).values({
    id,
    type: 'restore',
    serverId: id,
    projectId: id,
    payload: {},
    status: 'succeeded',
  })
  const payload = {
    serverId: id,
    token,
    jobId: id,
    offset: 0,
    content: 'Restore succeeded.\n',
  }
  try {
    await uploadOperationLogs(payload)
    await uploadOperationLogs(payload)
    expect(
      await logsDb
        .select()
        .from(operationLogs)
        .where(eq(operationLogs.jobId, id)),
    ).toHaveLength(1)
    await expect(
      uploadOperationLogs({ ...payload, content: 'Changed' }),
    ).rejects.toThrow('replay differs')
    await expect(
      uploadOperationLogs({ ...payload, offset: 200 }),
    ).rejects.toThrow('out of order')
    await expect(
      uploadOperationLogs({ ...payload, jobId: 'other' }),
    ).rejects.toThrow('not found')
    await expect(
      uploadOperationLogs({ ...payload, token: 'wrong' }),
    ).rejects.toThrow()
    await db
      .update(servers)
      .set({ status: 'disconnected' })
      .where(eq(servers.id, id))
    const request = new Request(
      'http://local/api/agents/job-logs?type=restore&id=' + id,
    )
    session.mockResolvedValue({ user: { id } })
    expect(await (await readOperationLogs(request)).json()).toEqual({
      content: payload.content,
      nextOffset: new TextEncoder().encode(payload.content).length,
    })
    const nextOffset = new TextEncoder().encode(payload.content).length
    const tail = 'Finished 🐻'
    await uploadOperationLogs({ ...payload, offset: nextOffset, content: tail })
    const suffix = await readOperationLogs(
      new Request(request.url + '&offset=' + nextOffset),
    )
    expect(await suffix.json()).toEqual({
      content: tail,
      nextOffset: nextOffset + new TextEncoder().encode(tail).length,
    })
    expect(
      (await readOperationLogs(new Request(request.url + '&offset=-1'))).status,
    ).toBe(400)
    session.mockResolvedValue({ user: { id: 'outsider' } })
    expect((await readOperationLogs(request)).status).toBe(404)
    session.mockResolvedValue(null)
    expect((await readOperationLogs(request)).status).toBe(401)
    session.mockResolvedValue({ user: { id } })
    await logsDb
      .update(operationLogs)
      .set({ createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(operationLogs.jobId, id))
    expect(await (await readOperationLogs(request)).json()).toEqual({
      content: '',
      nextOffset: 0,
    })
    await pruneExpiredRuntimeLogs()
    expect(
      await logsDb
        .select()
        .from(operationLogs)
        .where(eq(operationLogs.jobId, id)),
    ).toEqual([])
  } finally {
    await logsDb.delete(operationLogs).where(eq(operationLogs.jobId, id))
    await db.delete(agentJobs).where(eq(agentJobs.id, id))
    await db.delete(projects).where(eq(projects.id, id))
    await db.delete(servers).where(eq(servers.id, id))
    await db.delete(teamMembers).where(eq(teamMembers.id, id))
    await db.delete(teams).where(eq(teams.id, id))
    await db.delete(user).where(eq(user.id, id))
  }
})
