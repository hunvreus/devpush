import { asc, eq } from 'drizzle-orm'

import { config } from '@/server/config'
import { db } from '@/server/db'
import { user } from '@/server/db/schema'

type AdminCandidate = {
  id: string
  email: string
}

export async function isInstallationAdmin(candidate: AdminCandidate) {
  const configuredEmail = config.DEVPUSH_ADMIN_EMAIL?.trim().toLowerCase()

  if (configuredEmail) {
    return matchesInstallationAdmin({ candidate, configuredEmail })
  }

  const firstUser = await db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt), asc(user.id))
    .limit(1)

  return matchesInstallationAdmin({
    candidate,
    configuredEmail,
    firstUserId: firstUser.at(0)?.id,
  })
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
