import { isInstallationAdmin } from './access'
import { required } from '@/test/required'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest'
import { config } from '@/server/config'
import { closeDb, db } from '@/server/db'
import {
  allowlist,
  session,
  user,
  userCleanupJobs,
  teams,
  teamMembers,
} from '@/server/db/schema'
import { deleteUserState } from '@/server/users/deletion-state'
import { deleteUserAccount } from '@/server/users/service'
import {
  banUser,
  unbanUser,
  deleteAdminUser,
  importAllowlistEmails,
  addAllowlistRule,
  getAdminAllowlist,
  getAdminUsers,
} from './service'

beforeEach(async () => {
  await db.insert(user).values([
    {
      id: 'admin',
      name: 'Admin',
      username: 'admin',
      email: config.DEVPUSH_ADMIN_EMAIL || 'admin@example.com',
      createdAt: new Date(1),
    },
    {
      id: 'target',
      name: 'Target',
      username: 'target',
      email: 'target@example.com',
    },
  ])
  await db.insert(session).values({
    id: 'session',
    userId: 'target',
    token: 'token',
    expiresAt: new Date(Date.now() + 60_000),
  })
})
afterEach(async () => {
  await db.delete(allowlist)
  await db.delete(user)
})
afterAll(closeDb)

test('self-service deletion cannot select admin mode through extra input fields', async () => {
  const input = { userId: 'target', adminActorUserId: 'admin' }
  await expect(deleteUserAccount(input)).rejects.toThrow(
    'Type the account email to confirm deletion.',
  )
  expect(await db.select().from(userCleanupJobs)).toEqual([])
})

test.each(['active', 'banned'] as const)(
  'admins can queue deletion of %s users without self-service confirmation',
  async (status) => {
    await db.update(user).set({ status }).where(eq(user.id, 'target'))
    await deleteAdminUser({ actorUserId: 'admin', targetUserId: 'target' })
    expect(
      required((await db.select().from(user).where(eq(user.id, 'target')))[0])
        .status,
    ).toBe('deleted')
    expect(
      await db.select().from(session).where(eq(session.userId, 'target')),
    ).toEqual([])
    expect(
      await db
        .select()
        .from(userCleanupJobs)
        .where(eq(userCleanupJobs.userId, 'target')),
    ).toHaveLength(1)
  },
)

test('admin deletion rejects self-deletion and unauthorized actors', async () => {
  await expect(
    deleteAdminUser({ actorUserId: 'admin', targetUserId: 'admin' }),
  ).rejects.toThrow('You cannot delete yourself from admin.')
  await expect(
    deleteAdminUser({ actorUserId: 'target', targetUserId: 'admin' }),
  ).rejects.toThrow('Forbidden')
  expect(await db.select().from(userCleanupJobs)).toEqual([])
})

test('the final deletion write rechecks live installation-admin status', async () => {
  await db.update(user).set({ status: 'banned' }).where(eq(user.id, 'admin'))
  expect(
    await deleteUserState(db, {
      userId: 'target',
      email: 'target@example.com',
      adminActorUserId: 'admin',
      now: new Date(),
    }),
  ).toBe(false)
  expect(
    required((await db.select().from(user).where(eq(user.id, 'target')))[0])
      .status,
  ).toBe('active')
  expect(await db.select().from(userCleanupJobs)).toEqual([])
  expect(await db.select().from(session)).toHaveLength(1)
})

test('unbanning does not reactivate a deleted account', async () => {
  await db.update(user).set({ status: 'deleted' }).where(eq(user.id, 'target'))
  await unbanUser({ actorUserId: 'admin', targetUserId: 'target' })
  await banUser({ actorUserId: 'admin', targetUserId: 'target' })
  await unbanUser({ actorUserId: 'admin', targetUserId: 'target' })
  expect(
    required((await db.select().from(user).where(eq(user.id, 'target')))[0])
      .status,
  ).toBe('deleted')
})

test('unbanning restores a banned account', async () => {
  await banUser({ actorUserId: 'admin', targetUserId: 'target' })
  await unbanUser({ actorUserId: 'admin', targetUserId: 'target' })
  expect(
    required((await db.select().from(user).where(eq(user.id, 'target')))[0])
      .status,
  ).toBe('active')
})

test('ban and unban preserve the default team', async () => {
  const teamId = crypto.randomUUID()
  await db
    .insert(teams)
    .values({ id: teamId, name: 'Default team', slug: teamId })
  await db
    .insert(teamMembers)
    .values({
      id: crypto.randomUUID(),
      teamId,
      userId: 'target',
      role: 'owner',
    })
  await db
    .update(user)
    .set({ defaultTeamId: teamId })
    .where(eq(user.id, 'target'))
  try {
    await banUser({ actorUserId: 'admin', targetUserId: 'target' })
    await unbanUser({ actorUserId: 'admin', targetUserId: 'target' })
    expect(
      (await db.select().from(user).where(eq(user.id, 'target')))[0]
        ?.defaultTeamId,
    ).toBe(teamId)
  } finally {
    await db
      .update(user)
      .set({ defaultTeamId: null })
      .where(eq(user.id, 'target'))
    await db.delete(teams).where(eq(teams.id, teamId))
  }
})

test('banning removes sessions and changes account status atomically', async () => {
  await banUser({ actorUserId: 'admin', targetUserId: 'target' })
  expect(await db.select().from(session)).toEqual([])
  expect(
    required((await db.select().from(user).where(eq(user.id, 'target')))[0])
      .status,
  ).toBe('banned')
})

test('a failed ban preserves sessions and unauthorized users cannot ban accounts', async () => {
  await expect(
    banUser({ actorUserId: 'target', targetUserId: 'admin' }),
  ).rejects.toThrow('Forbidden')
  await db.run(sql`create trigger reject_ban before update of status on user
    when new.id = 'target' and new.status = 'banned' begin select raise(abort, 'simulated ban failure'); end`)
  try {
    await expect(
      banUser({ actorUserId: 'admin', targetUserId: 'target' }),
    ).rejects.toThrow()
    expect(await db.select().from(session)).toHaveLength(1)
    expect(
      required((await db.select().from(user).where(eq(user.id, 'target')))[0])
        .status,
    ).toBe('active')
  } finally {
    await db.run(sql`drop trigger reject_ban`)
  }
})

test('bulk import handles hundreds of addresses and deduplicates normalized values', async () => {
  const emails = Array.from({ length: 500 }, (_, i) => `user${i}@example.com`)
  await importAllowlistEmails({
    actorUserId: 'admin',
    emails: [...emails, 'USER0@example.com'].join(','),
  })
  expect(await db.select().from(allowlist)).toHaveLength(500)
  await importAllowlistEmails({
    actorUserId: 'admin',
    emails: emails.join(' '),
  })
  expect(await db.select().from(allowlist)).toHaveLength(500)
})
test('invalid imports and failed inserts never partially change the allowlist', async () => {
  await expect(
    importAllowlistEmails({
      actorUserId: 'admin',
      emails: 'valid@example.com, invalid',
    }),
  ).rejects.toThrow()
  expect(await db.select().from(allowlist)).toHaveLength(0)
  await db.run(
    sql`create trigger reject_allowlist before insert on allowlist when new.value = 'reject@example.com' begin select raise(abort, 'simulated import failure'); end`,
  )
  try {
    await expect(
      importAllowlistEmails({
        actorUserId: 'admin',
        emails: 'valid@example.com,reject@example.com',
      }),
    ).rejects.toThrow()
    expect(await db.select().from(allowlist)).toHaveLength(0)
  } finally {
    await db.run(sql`drop trigger reject_allowlist`)
  }
})
test('rule validation and import permissions remain enforced by the service', async () => {
  await expect(
    addAllowlistRule({
      actorUserId: 'admin',
      type: 'domain',
      value: 'https://example.com',
    }),
  ).rejects.toThrow()
  await expect(
    importAllowlistEmails({
      actorUserId: 'target',
      emails: 'valid@example.com',
    }),
  ).rejects.toThrow('Forbidden')
  expect(await db.select().from(allowlist)).toHaveLength(0)
})

test('allowlist pages are bounded, stable and searchable across the entire rule set', async () => {
  await db.insert(allowlist).values(
    Array.from({ length: 60 }, (_, index) => ({
      id: `rule-${String(index).padStart(3, '0')}`,
      type: 'email' as const,
      value: `person${index}@example.com`,
      createdAt: new Date(1000),
    })),
  )
  const actor = {
    id: 'admin',
    email: config.DEVPUSH_ADMIN_EMAIL || 'admin@example.com',
  }
  const first = await getAdminAllowlist(actor)
  const second = await getAdminAllowlist(actor, { allowlistPage: 2 })
  expect(first.items).toHaveLength(25)
  expect(second.items).toHaveLength(25)
  expect(first.pagination).toMatchObject({ total: 60, pageCount: 3 })
  expect(
    new Set([...first.items, ...second.items].map((rule) => rule.id)).size,
  ).toBe(50)
  const last = await getAdminAllowlist(actor, { allowlistPage: 999 })
  expect(last.items).toHaveLength(10)
  expect(last.pagination.page).toBe(3)
  const found = await getAdminAllowlist(actor, {
    allowlistQuery: 'PERSON0@EXAMPLE.COM',
    allowlistPage: 3,
  })
  expect(found.items.map((rule) => rule.value)).toEqual(['person0@example.com'])
  expect(found.pagination.page).toBe(1)
  expect(
    (await getAdminAllowlist(actor, { allowlistQuery: '%' })).items,
  ).toEqual([])
  expect(
    (await getAdminAllowlist(actor, { allowlistQuery: '_' })).items,
  ).toEqual([])
  expect(
    (await getAdminAllowlist(actor, { allowlistQuery: 'email' })).pagination
      .total,
  ).toBe(60)
  await expect(
    getAdminAllowlist({ id: 'target', email: 'target@example.com' }),
  ).rejects.toThrow('Forbidden')
})

test('deleting the final rule on a page clamps the next read to an existing page', async () => {
  const actor = {
    id: 'admin',
    email: config.DEVPUSH_ADMIN_EMAIL || 'admin@example.com',
  }
  await db.insert(allowlist).values(
    Array.from({ length: 26 }, (_, index) => ({
      id: `rule-${index}`,
      type: 'email' as const,
      value: `${index}@example.com`,
    })),
  )
  const last = await getAdminAllowlist(actor, { allowlistPage: 2 })
  await db.delete(allowlist).where(eq(allowlist.id, last.items[0]!.id))
  const result = await getAdminAllowlist(actor, { allowlistPage: 2 })
  expect(result.pagination).toMatchObject({ page: 1, total: 25, pageCount: 1 })
  expect(result.items).toHaveLength(25)
})

test('Admin users beyond the old 50-account cutoff remain searchable and pageable', async () => {
  await db.insert(user).values(
    Array.from({ length: 60 }, (_, index) => ({
      id: `extra-${String(index).padStart(3, '0')}`,
      name: `Person ${index}`,
      username: `person-${index}`,
      email: `person-${index}@example.com`,
      createdAt: new Date(1000),
    })),
  )
  const actor = {
    id: 'admin',
    email: config.DEVPUSH_ADMIN_EMAIL || 'admin@example.com',
  }
  const first = await getAdminUsers(actor)
  const second = await getAdminUsers(actor, { userPage: 2 })
  const third = await getAdminUsers(actor, { userPage: 3 })
  expect(first.pagination).toMatchObject({ total: 62, pageCount: 3 })
  expect(first.items).toHaveLength(25)
  expect(second.items).toHaveLength(25)
  expect(third.items).toHaveLength(12)
  expect(
    new Set(
      [...first.items, ...second.items, ...third.items].map(
        (entry) => entry.id,
      ),
    ).size,
  ).toBe(62)
  const result = await getAdminUsers(actor, {
    userQuery: 'PERSON-0@EXAMPLE.COM',
    userPage: 99,
  })
  expect(result.items.map((entry) => entry.id)).toEqual(['extra-000'])
  expect(result.pagination.page).toBe(1)
  expect((await getAdminUsers(actor, { userQuery: '%' })).items).toEqual([])
  await expect(
    getAdminUsers({ id: 'target', email: 'target@example.com' }),
  ).rejects.toThrow('Forbidden')
})

test('administrator authority uses the current active database account, not stale session claims', async () => {
  expect(
    await isInstallationAdmin({
      id: 'target',
      email: config.DEVPUSH_ADMIN_EMAIL || 'admin@example.com',
    }),
  ).toBe(false)
  await db.update(user).set({ status: 'banned' }).where(eq(user.id, 'admin'))
  expect(
    await isInstallationAdmin({
      id: 'admin',
      email: config.DEVPUSH_ADMIN_EMAIL || 'admin@example.com',
    }),
  ).toBe(false)
})
