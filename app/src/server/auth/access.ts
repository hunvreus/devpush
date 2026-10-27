import { eq, sql } from 'drizzle-orm'
import { isValidAllowlistPattern } from '#devpush/lib/allowlist-schema'

import { db } from '#devpush/server/db'
import { allowlist, user } from '#devpush/server/db/schema'

export { isValidAllowlistPattern } from '#devpush/lib/allowlist-schema'

export async function assertEmailCanAuthenticate(
  email: string | null | undefined,
) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    throw new Error('Email address is required.')
  }

  const [existingUsers, allowlisted] = await Promise.all([
    db
      .select({ status: user.status })
      .from(user)
      .where(sql`lower(${user.email}) = ${normalizedEmail}`)
      .limit(1),
    isEmailAllowlisted(normalizedEmail),
  ])
  const existingUser = existingUsers.at(0)

  if (existingUser?.status === 'banned') {
    throw new Error('This account has been banned.')
  }

  if (existingUser?.status === 'deleted') {
    throw new Error('This account has been deleted.')
  }

  if (!allowlisted) {
    throw new Error('This email address is not allowed to sign in.')
  }
}

export async function assertUserCanCreateSession(userId: string) {
  const [currentUsers, entries] = await Promise.all([
    db
      .select({ email: user.email, status: user.status })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1),
    listAllowlistEntries(),
  ])
  const currentUser = currentUsers.at(0)

  if (!currentUser || currentUser.status !== 'active') {
    throw new Error('This account cannot sign in.')
  }

  if (!isEmailAllowedByEntries(currentUser.email, entries)) {
    throw new Error('This email address is not allowed to sign in.')
  }
}

export async function isEmailAllowlisted(email: string) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return false

  return isEmailAllowedByEntries(normalizedEmail, await listAllowlistEntries())
}

function listAllowlistEntries() {
  return db
    .select({ type: allowlist.type, value: allowlist.value })
    .from(allowlist)
}

function isEmailAllowedByEntries(
  email: string,
  entries: Array<{ type: 'domain' | 'email' | 'pattern'; value: string }>,
) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return false

  if (entries.length === 0) {
    return true
  }

  const domain = normalizedEmail.split('@').at(1) ?? ''

  return entries.some((entry) => {
    const value = entry.value.trim().toLowerCase()

    if (entry.type === 'email') {
      return value === normalizedEmail
    }

    if (entry.type === 'domain') {
      return value.replace(/^@/, '') === domain
    }

    try {
      if (!isValidAllowlistPattern(entry.value)) return false
      return new RegExp(`^(?:${entry.value})$`, 'i').test(normalizedEmail)
    } catch {
      return false
    }
  })
}

export function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null
}
