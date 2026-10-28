import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { db, closeDb } from '#devpush/server/db'
import { config } from '#devpush/server/config'
import {
  teams,
  teamMembers,
  user,
  projects,
  notificationOutbox,
  notificationIncidents,
  notificationMutes,
  servers,
  environments,
  deployments,
  account,
  serverMetrics,
  domains,
  backupRuns,
} from '#devpush/server/db/schema'
import {
  observeOperationalNotification,
  deliverOperationalNotifications,
} from './outbox'
import type { OperationalObservation } from './outbox'
import {
  readNotificationPreferences,
  saveNotificationPreferences,
  saveNotificationMute,
} from './preferences'
import {
  observeProjectNotifications,
  observeServerNotifications,
  maintainOperationalNotifications,
} from './observe'
import { defaultNotificationPreferences } from '#devpush/lib/notification-preferences'

const send = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('#devpush/server/email/service', () => ({
  sendEmail: send,
  renderNotificationEmail: vi.fn().mockResolvedValue('<p>notification</p>'),
}))
const ids: string[] = []
const original = {
  EMAIL_FROM: config.EMAIL_FROM,
  RESEND_API_KEY: config.RESEND_API_KEY,
}
beforeEach(() => {
  send.mockReset().mockResolvedValue(undefined)
  config.EMAIL_FROM = 'devpush <test@example.test>'
  config.RESEND_API_KEY = 'test-key'
})
afterEach(async () => {
  await db.delete(projects).where(eq(projects.teamId, ids[0] ?? ''))
  await db.delete(teams).where(eq(teams.id, ids[0] ?? ''))
  for (const id of ids.slice(1)) await db.delete(user).where(eq(user.id, id))
  ids.length = 0
  Object.assign(config, original)
})
afterAll(closeDb)
async function fixture() {
  const teamId = randomUUID()
  ids.push(teamId)
  await db.insert(teams).values({ id: teamId, name: 'Example', slug: teamId })
  const members: Record<string, string> = {}
  for (const role of ['owner', 'admin', 'member'] as const) {
    const id = randomUUID()
    ids.push(id)
    members[role] = id
    await db.insert(user).values({
      id,
      name: role,
      username: id,
      email: `${id}@example.test`,
      emailVerified: true,
    })
    await db
      .insert(teamMembers)
      .values({ id: randomUUID(), teamId, userId: id, role })
  }
  const projectId = randomUUID()
  await db.insert(projects).values({
    id: projectId,
    teamId,
    name: 'Project',
    slug: 'project',
    githubRepo: 'example/repo',
  })
  const incident: OperationalObservation = {
    id: randomUUID(),
    sourceId: 'example',
    teamId,
    projectId,
    category: 'deployments',
    failed: true,
    revision: 'first',
    at: Date.now(),
    title: 'Deployment failed',
    message: 'Open logs for details.',
    path: '/settings',
    actorId: members.member,
  }
  return { teamId, projectId, members, incident }
}
test('failure recipients are owners/admins and the identified actor, deduplicated across repeated observations', async () => {
  const f = await fixture()
  await observeOperationalNotification(f.incident)
  await observeOperationalNotification(f.incident)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(3)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(3)
})

test('recovery reaches only recipients whose failure email was delivered', async () => {
  const f = await fixture()
  await saveNotificationPreferences(
    f.members.admin!,
    { ...defaultNotificationPreferences, deployments: false },
    0,
  )
  await observeOperationalNotification(f.incident)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(2)
  await saveNotificationPreferences(
    f.members.admin!,
    defaultNotificationPreferences,
    1,
  )
  await observeOperationalNotification({
    ...f.incident,
    failed: false,
    at: f.incident.at + 1,
  })
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(4)
  expect(
    send.mock.calls.filter((call) => call[0].subject.startsWith('Recovered:')),
  ).toHaveLength(2)
})
test('workspace and project mutes filter operational delivery, not other members', async () => {
  const f = await fixture()
  await saveNotificationMute(
    f.members.owner!,
    { kind: 'workspace', id: f.teamId },
    true,
  )
  await saveNotificationMute(
    f.members.admin!,
    { kind: 'project', id: f.projectId },
    true,
  )
  await observeOperationalNotification(f.incident)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]![0].to).toBe(`${f.members.member}@example.test`)
})
test('membership and active-user status are rechecked at delivery', async () => {
  const f = await fixture()
  await observeOperationalNotification(f.incident)
  await db
    .delete(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, f.teamId),
        eq(teamMembers.userId, f.members.member!),
      ),
    )
  await db
    .update(user)
    .set({ status: 'deleted' })
    .where(eq(user.id, f.members.admin!))
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(1)
})
test('one recipient failure is retried with the same delivery key without resending successful recipients', async () => {
  const f = await fixture()
  send.mockImplementation(async (message) => {
    if (message.to === `${f.members.owner}@example.test`)
      throw new Error('temporary')
  })
  await observeOperationalNotification(f.incident)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(3)
  const first = send.mock.calls.find(
    (call) => call[0].to === `${f.members.owner}@example.test`,
  )!
  send.mockResolvedValue(undefined)
  await deliverOperationalNotifications(50, Date.now() + 61_000)
  expect(send).toHaveBeenCalledTimes(4)
  expect(send.mock.calls[3]![1]).toBe(first[1])
})
test('a failure recovered before delivery is discarded rather than sending stale failure or recovery mail', async () => {
  const f = await fixture()
  await observeOperationalNotification(f.incident)
  await observeOperationalNotification({
    ...f.incident,
    failed: false,
    at: f.incident.at + 1,
  })
  await deliverOperationalNotifications()
  expect(send).not.toHaveBeenCalled()
})
test('preferences use optimistic version checks and private mutes require membership', async () => {
  const f = await fixture()
  expect(
    (await readNotificationPreferences(f.members.owner!)).preferences,
  ).toEqual(defaultNotificationPreferences)
  await saveNotificationPreferences(
    f.members.owner!,
    { ...defaultNotificationPreferences, servers: false },
    0,
  )
  await expect(
    saveNotificationPreferences(
      f.members.owner!,
      defaultNotificationPreferences,
      0,
    ),
  ).rejects.toThrow()
  expect(
    (await readNotificationPreferences(f.members.owner!)).preferences.servers,
  ).toBe(false)
  await db.delete(teamMembers).where(eq(teamMembers.userId, f.members.member!))
  await expect(
    saveNotificationMute(
      f.members.member!,
      { kind: 'workspace', id: f.teamId },
      true,
    ),
  ).rejects.toThrow()
  expect(
    await db
      .select()
      .from(notificationMutes)
      .where(eq(notificationMutes.userId, f.members.member!)),
  ).toHaveLength(0)
})
test('expired retries stop after 24 hours and remain visible for operator inspection', async () => {
  const f = await fixture()
  await observeOperationalNotification(f.incident)
  send.mockRejectedValue(new Error('provider unavailable'))
  const startedAt = Date.now()
  await deliverOperationalNotifications(50, startedAt)
  send.mockClear()
  await deliverOperationalNotifications(50, startedAt + 86_401_000)
  expect(send).not.toHaveBeenCalled()
  const rows = await db.select().from(notificationOutbox)
  expect(
    rows
      .filter((row) => row.incidentId === f.incident.id)
      .every((row) => row.failedAt !== null),
  ).toBe(true)
})

async function sourceFixture() {
  const f = await fixture(),
    serverId = randomUUID(),
    environmentId = randomUUID()
  await db.insert(servers).values({
    id: serverId,
    teamId: f.teamId,
    name: 'Server',
    handle: 'server',
    status: 'connected',
    lastSeenAt: new Date(),
  })
  await db.insert(environments).values({
    id: environmentId,
    projectId: f.projectId,
    name: 'Production',
    slug: 'production',
    branch: 'main',
    runtimeId: 'runtime',
  })
  return { ...f, serverId, environmentId }
}
test('Git sender metadata maps to a linked current member without changing authorization identity', async () => {
  const f = await sourceFixture()
  await db.insert(account).values({
    id: randomUUID(),
    userId: f.members.member!,
    providerId: 'github',
    accountId: '12345',
  })
  await db.insert(deployments).values({
    id: randomUUID(),
    environmentId: f.environmentId,
    serverId: f.serverId,
    status: 'failed',
    trigger: 'webhook',
    repoId: 1,
    repoFullName: 'example/repo',
    gitSha: 'abc',
    gitBranch: 'main',
    commitMeta: { message: 'message', githubSenderId: '12345' },
    config: {},
    envVars: '[]',
    runtimeId: 'runtime',
    finishedAt: new Date(),
  })
  await observeProjectNotifications(f.projectId)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(3)
  const [deployment] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.environmentId, f.environmentId))
  expect(deployment!.createdByUserId).toBeNull()
})
test('server disconnect grace, disk warning hysteresis and recovery use persisted observations', async () => {
  const f = await sourceFixture(),
    now = Date.now()
  await observeServerNotifications(f.serverId, now + 120_000)
  await deliverOperationalNotifications()
  expect(send).not.toHaveBeenCalled()
  await observeServerNotifications(f.serverId, now + 360_000)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(2)
  await db
    .update(servers)
    .set({ lastSeenAt: new Date(now + 370_000) })
    .where(eq(servers.id, f.serverId))
  await observeServerNotifications(f.serverId, now + 371_000)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(4)
  await db.insert(serverMetrics).values({
    id: randomUUID(),
    serverId: f.serverId,
    observedAt: new Date(now + 371_000),
    diskUsedBytes: 95,
    diskTotalBytes: 100,
  })
  await observeServerNotifications(f.serverId, now + 372_000)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(6)
})
test('domain and backup source scans generate alerts and repeated scans do not resend', async () => {
  const f = await sourceFixture()
  await db.insert(domains).values({
    id: randomUUID(),
    projectId: f.projectId,
    environmentId: f.environmentId,
    hostname: 'example.test',
    status: 'failed',
  })
  await db.insert(backupRuns).values({
    id: randomUUID(),
    projectId: f.projectId,
    environmentId: f.environmentId,
    serverId: f.serverId,
    runtimeId: 'runtime',
    status: 'failed',
    finishedAt: new Date(),
  })
  await observeProjectNotifications(f.projectId)
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(4)
  await maintainOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(4)
})

test('a later initiating member receives their failure without resending to owners, and both actors receive recovery', async () => {
  const f = await fixture()
  await observeOperationalNotification(f.incident)
  await deliverOperationalNotifications()
  const other = randomUUID()
  ids.push(other)
  await db.insert(user).values({
    id: other,
    name: 'Other',
    username: other,
    email: `${other}@example.test`,
    emailVerified: true,
  })
  await db.insert(teamMembers).values({
    id: randomUUID(),
    teamId: f.teamId,
    userId: other,
    role: 'member',
  })
  await observeOperationalNotification({
    ...f.incident,
    actorId: other,
    revision: 'second-deploy',
    at: f.incident.at + 1,
  })
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(4)
  await observeOperationalNotification({
    ...f.incident,
    failed: false,
    at: f.incident.at + 2,
  })
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(8)
})
test('retry payloads remain frozen even if a later failure changes the incident details', async () => {
  const f = await fixture()
  send.mockRejectedValue(new Error('temporary'))
  await observeOperationalNotification(f.incident)
  await deliverOperationalNotifications()
  const initial = new Map(send.mock.calls.map((call) => [call[1], call[0]]))
  await observeOperationalNotification({
    ...f.incident,
    at: f.incident.at + 1,
    path: '/different',
    title: 'Renamed',
    message: 'Different details',
  })
  send.mockClear().mockResolvedValue(undefined)
  await deliverOperationalNotifications(50, Date.now() + 61_000)
  expect(send).toHaveBeenCalledTimes(3)
  for (const call of send.mock.calls)
    expect(call[0]).toEqual(initial.get(call[1]))
})
test('scheduled recipient repair catches recovery after an in-flight failure finishes sending', async () => {
  const f = await sourceFixture()
  let finish!: () => void
  const input = {
    ...f.incident,
    id: `extension:${f.serverId}:certificate`,
    sourceId: f.serverId,
    projectId: null,
    category: 'domains' as const,
    actorId: null,
  }
  await observeOperationalNotification(input)
  send.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const delivery = deliverOperationalNotifications(1)
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  await observeOperationalNotification({
    ...input,
    failed: false,
    at: input.at + 1,
  })
  finish()
  await delivery
  const { repairOperationalRecipients } = await import('./outbox')
  await repairOperationalRecipients()
  await deliverOperationalNotifications()
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls[1]![0].subject).toContain('Recovered:')
})

test('unsent operational notices keep their delivery window and freeze the sender across retries', async () => {
  const f = await fixture()
  await observeOperationalNotification(f.incident)
  const queuedSender = config.EMAIL_FROM
  config.EMAIL_FROM = 'Changed <changed@example.test>'
  send.mockRejectedValue(new Error('provider unavailable'))
  const firstAttempt = Date.now() + 2 * 86_400_000
  await deliverOperationalNotifications(50, firstAttempt)
  expect(send).toHaveBeenCalled()
  expect(send.mock.calls[0]![0].from).toBe(queuedSender)
  const attempts = send.mock.calls.map((call) => call)
  send.mockClear().mockResolvedValue(undefined)
  await deliverOperationalNotifications(50, firstAttempt + 61_000)
  expect(send.mock.calls).toEqual(attempts)
})

test('pruning an obsolete incident cascades its same-revision recipient payloads', async () => {
  const f = await fixture()
  await observeOperationalNotification(f.incident)
  const old = Date.now() - 31 * 86_400_000
  await db
    .update(notificationIncidents)
    .set({ active: false, updatedAt: old })
    .where(eq(notificationIncidents.id, f.incident.id))
  await db
    .update(notificationOutbox)
    .set({ createdAt: old })
    .where(eq(notificationOutbox.incidentId, f.incident.id))
  const { pruneOperationalNotifications } = await import('./outbox')
  await pruneOperationalNotifications()
  expect(
    await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.incidentId, f.incident.id)),
  ).toEqual([])
})
