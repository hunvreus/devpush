import { and, desc, eq, sql, or, count } from 'drizzle-orm'
import {
  allowlistRuleSchema,
  allowlistImportSchema,
  parseAllowlistEmails,
} from '#devpush/lib/allowlist-schema'

import { adminSearchSchema } from '#devpush/lib/admin-search-schema'
import { db } from '#devpush/server/db'
import { allowlist, session, user } from '#devpush/server/db/schema'
import { getInstallationInfo } from '#devpush/server/admin/installation'
import { deleteUserAccountAsAdmin } from '#devpush/server/users/service'
import {
  requireInstallationAdmin,
  requireInstallationAdminById,
  installationAdminPredicate,
} from '#devpush/server/admin/access'

export type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>
export type AllowlistRuleType = 'email' | 'domain' | 'pattern'

export async function getAdminOverview(
  actor: { id: string; email: string },
  search: {
    allowlistQuery?: string
    allowlistPage?: number
    userQuery?: string
    userPage?: number
  } = {},
) {
  await requireInstallationAdmin(actor)
  const [users, allowlistEntries, installation] = await Promise.all([
    getAdminUsers(actor, search),
    getAdminAllowlist(actor, search),
    getInstallationInfo({ includeLatest: false }),
  ])

  return {
    installation,
    users: users.items,
    userPagination: users.pagination,
    allowlist: allowlistEntries.items,
    allowlistPagination: allowlistEntries.pagination,
  }
}

export async function getAdminUsers(
  actor: { id: string; email: string },
  search: { userQuery?: string; userPage?: number } = {},
) {
  await requireInstallationAdmin(actor)
  const { userQuery: query, userPage: requestedPage } =
    adminSearchSchema.parse(search)
  const escaped = query.replace(/[\\%_]/g, '\\$&')
  const where = query
    ? or(
        ...[user.name, user.username, user.email, user.status].map(
          (column) => sql`${column} like ${`%${escaped}%`} escape '\\'`,
        ),
      )
    : undefined
  const [totalRow] = await db.select({ total: count() }).from(user).where(where)
  const total = totalRow?.total ?? 0
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, pageCount)
  const entries = await db
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
    .where(where)
    .orderBy(desc(user.createdAt), desc(user.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  return {
    items: entries.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
    pagination: { query, page, pageCount, total, pageSize },
  }
}

export async function getAdminAllowlist(
  actor: { id: string; email: string },
  search: { allowlistQuery?: string; allowlistPage?: number } = {},
) {
  await requireInstallationAdmin(actor)
  const { allowlistQuery: query, allowlistPage: requestedPage } =
    adminSearchSchema.parse(search)
  // Treat SQL wildcard characters as literal search text.
  const escaped = query.replace(/[\\%_]/g, '\\$&')
  const where = query
    ? or(
        sql`${allowlist.value} like ${`%${escaped}%`} escape '\\'`,
        sql`${allowlist.type} like ${`%${escaped}%`} escape '\\'`,
      )
    : undefined
  const [totalRow] = await db
    .select({ total: count() })
    .from(allowlist)
    .where(where)
  const total = totalRow?.total ?? 0
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, pageCount)
  const entries = await db
    .select({
      id: allowlist.id,
      type: allowlist.type,
      value: allowlist.value,
      createdAt: allowlist.createdAt,
    })
    .from(allowlist)
    .where(where)
    .orderBy(desc(allowlist.createdAt), desc(allowlist.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  return {
    items: entries.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
    pagination: { query, page, pageCount, total, pageSize },
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
    db
      .delete(session)
      .where(
        and(
          eq(session.userId, targetUserId),
          installationAdminPredicate(actorUserId),
        ),
      ),
    db
      .update(user)
      .set({ status: 'banned', updatedAt: new Date() })
      .where(
        and(
          eq(user.id, targetUserId),
          eq(user.status, 'active'),
          installationAdminPredicate(actorUserId),
        ),
      ),
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
    .where(
      and(
        eq(user.id, targetUserId),
        eq(user.status, 'banned'),
        installationAdminPredicate(actorUserId),
      ),
    )
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

  await deleteUserAccountAsAdmin({
    userId: targetUserId,
    adminActorUserId: actorUserId,
  })
}
