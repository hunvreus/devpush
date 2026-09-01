import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/server/db'
import { allowlist, session, user } from '@/server/db/schema'
import { isValidAllowlistPattern, normalizeEmail } from '@/server/auth/access'
import { getInstallationInfo } from '@/server/admin/installation'
import { deleteUserAccount } from '@/server/users/service'
import { requireInstallationAdminById } from '@/server/admin/access'

export type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>
export type AllowlistRuleType = 'email' | 'domain' | 'pattern'

const emailSchema = z.string().trim().email().max(320)

export async function getAdminOverview(actorUserId: string) {
  await requireInstallationAdminById(actorUserId)
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
    getInstallationInfo(),
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
  const normalizedValue = normalizeAllowlistValue(type, value)

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
  const values = Array.from(
    new Set(
      emails
        .split(/[\s,]+/)
        .map((value) => normalizeEmail(value))
        .filter((value): value is string => Boolean(value)),
    ),
  )

  if (values.length === 0) {
    throw new Error('Enter at least one email address.')
  }

  const invalidEmail = values.find(
    (value) => !emailSchema.safeParse(value).success,
  )

  if (invalidEmail) {
    throw new Error(`Invalid email address: ${invalidEmail}.`)
  }

  await db
    .insert(allowlist)
    .values(
      values.map((value) => ({
        id: crypto.randomUUID(),
        type: 'email' as const,
        value,
      })),
    )
    .onConflictDoNothing()
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

  await db.transaction(async (tx) => {
    await tx.delete(session).where(eq(session.userId, targetUserId))
    await tx
      .update(user)
      .set({ status: 'banned', defaultTeamId: null, updatedAt: new Date() })
      .where(eq(user.id, targetUserId))
  })
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

function normalizeAllowlistValue(type: AllowlistRuleType, value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    throw new Error('Value is required.')
  }

  if (type === 'email') {
    const result = emailSchema.safeParse(trimmedValue)

    if (!result.success) {
      throw new Error('Enter a valid email address.')
    }

    return result.data.toLowerCase()
  }

  if (type === 'domain') {
    return trimmedValue.toLowerCase().replace(/^@/, '')
  }

  if (!isValidAllowlistPattern(trimmedValue)) {
    throw new Error('Enter a valid regular expression.')
  }

  return trimmedValue
}
