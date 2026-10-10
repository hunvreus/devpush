import { required } from '@/test/required'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest'
import { config } from '@/server/config'
import { closeDb, db } from '@/server/db'
import { allowlist, session, user } from '@/server/db/schema'
import { banUser, importAllowlistEmails, addAllowlistRule } from './service'

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
