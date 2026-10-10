import { desc, eq, sql } from 'drizzle-orm'
import {
  allowlistRuleSchema,
  allowlistImportSchema,
  parseAllowlistEmails,
} from '@/lib/allowlist-schema'

import { db } from '@/server/db'
import { allowlist, session, user } from '@/server/db/schema'
import { getInstallationInfo } from '@/server/admin/installation'
import { deleteUserAccount } from '@/server/users/service'
import {
  requireInstallationAdmin,
  requireInstallationAdminById,
} from '@/server/admin/access'

export type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>
export type AllowlistRuleType = 'email' | 'domain' | 'pattern'

export async function getAdminOverview(actor: { id: string; email: string }) {
  await requireInstallationAdmin(actor)
  const [users, allowlistEntries, installation] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        status: user.status,
        image: user.image,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(50),
    db
      .select({
        id: allowlist.id,
        type: allowlist.type,
        value: allowlist.value,
        createdAt: allowlist.createdAt,
      })
      .from(allowlist)
      .orderBy(desc(allowlist.createdAt)),
    getInstallationInfo({ includeLatest: false }),
  ])

  return {
    installation,
    users: users.map((item) => ({
      id: item.id,
      name: item.name,
      username: item.username,
      email: item.email,
      emailVerified: item.emailVerified,
      status: item.status,
      image: item.image,
      createdAt: item.createdAt.toISOString(),
    })),
    allowlist: allowlistEntries.map((item) => ({
      id: item.id,
      type: item.type,
      value: item.value,
      createdAt: item.createdAt.toISOString(),
    })),
  }
}

export async function addAllowlistRule({
  actorUserId,
  type,
  value,
}: {
  actorUserId: string
  type: AllowlistRuleType
  value: string
}) {
  await requireInstallationAdminById(actorUserId)
  const normalizedValue = allowlistRuleSchema.parse({ type, value }).value

  await db
    .insert(allowlist)
    .values({
      id: crypto.randomUUID(),
      type,
      value: normalizedValue,
    })
    .onConflictDoNothing()
}

export async function importAllowlistEmails({
  actorUserId,
  emails,
}: {
  actorUserId: string
  emails: string
}) {
  await requireInstallationAdminById(actorUserId)
  const parsed = allowlistImportSchema.parse({ emails })
  const entries = parseAllowlistEmails(parsed.emails).map((value) => ({
    id: crypto.randomUUID(),
    value,
  }))
  // One bound JSON value keeps large imports within every SQLite driver's limit.
  await db.run(sql`insert into ${allowlist} (id, type, value)
    select json_extract(value, '$.id'), 'email', json_extract(value, '$.value')
    from json_each(${JSON.stringify(entries)}) where true
    on conflict do nothing`)
}

export async function deleteAllowlistRule({
  actorUserId,
  id,
}: {
  actorUserId: string
  id: string
}) {
  await requireInstallationAdminById(actorUserId)
  await db.delete(allowlist).where(eq(allowlist.id, id))
}

export async function banUser({
  actorUserId,
  targetUserId,
}: {
  actorUserId: string
  targetUserId: string
}) {
  await requireInstallationAdminById(actorUserId)
  if (actorUserId === targetUserId) {
    throw new Error('You cannot ban yourself.')
  }

  await db.batch([
    db.delete(session).where(eq(session.userId, targetUserId)),
    db
      .update(user)
      .set({ status: 'banned', defaultTeamId: null, updatedAt: new Date() })
      .where(eq(user.id, targetUserId)),
  ])
}

export async function unbanUser({
  actorUserId,
  targetUserId,
}: {
  actorUserId: string
  targetUserId: string
}) {
  await requireInstallationAdminById(actorUserId)
  if (actorUserId === targetUserId) {
    throw new Error('You cannot unban yourself.')
  }

  await db
    .update(user)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(user.id, targetUserId))
}

export async function deleteAdminUser({
  actorUserId,
  targetUserId,
}: {
  actorUserId: string
  targetUserId: string
}) {
  await requireInstallationAdminById(actorUserId)
  if (actorUserId === targetUserId) {
    throw new Error('You cannot delete yourself from admin.')
  }

  await deleteUserAccount({ userId: targetUserId })
}
