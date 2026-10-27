import { and, eq, sql } from 'drizzle-orm'

import { config } from '#devpush/server/config'
import { db } from '#devpush/server/db'
import { user } from '#devpush/server/db/schema'

type AdminCandidate = {
  id: string
  email: string
}

export async function isInstallationAdmin(candidate: AdminCandidate) {
  const [current] = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(eq(user.id, candidate.id), installationAdminPredicate(candidate.id)),
    )
    .limit(1)
  return Boolean(current)
}

export function installationAdminPredicate(userId: string) {
  const email = config.DEVPUSH_ADMIN_EMAIL?.trim().toLowerCase()
  return sql`exists(select 1 from user as admin_actor where admin_actor.id = ${userId}
    and admin_actor.status = 'active' and ${
      email
        ? sql`lower(trim(admin_actor.email)) = ${email}`
        : sql`admin_actor.id = (select id from user order by created_at, id limit 1)`
    })`
}

export function matchesInstallationAdmin({
  candidate,
  configuredEmail,
  firstUserId,
}: {
  candidate: AdminCandidate
  configuredEmail?: string
  firstUserId?: string
}) {
  return configuredEmail
    ? candidate.email.trim().toLowerCase() ===
        configuredEmail.trim().toLowerCase()
    : candidate.id === firstUserId
}

export async function requireInstallationAdmin(candidate: AdminCandidate) {
  if (!(await isInstallationAdmin(candidate))) {
    throw new Error('Forbidden')
  }
}

export async function requireInstallationAdminById(userId: string) {
  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const candidate = rows.at(0)

  if (!candidate) {
    throw new Error('Forbidden')
  }

  await requireInstallationAdmin(candidate)
}
