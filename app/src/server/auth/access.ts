import { sql } from 'drizzle-orm'

import { db } from '@/server/db'
import { allowlist, user } from '@/server/db/schema'

export async function assertEmailCanAuthenticate(email: string | null | undefined) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    throw new Error('Email address is required.')
  }

  const existingUsers = await db
    .select({ status: user.status })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalizedEmail}`)
    .limit(1)
  const existingUser = existingUsers.at(0)

  if (existingUser?.status === 'banned') {
    throw new Error('This account has been banned.')
  }

  if (existingUser?.status === 'deleted') {
    throw new Error('This account has been deleted.')
  }

  if (!(await isEmailAllowlisted(normalizedEmail))) {
    throw new Error('This email address is not allowed to sign in.')
  }
}

export async function isEmailAllowlisted(email: string) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return false

  const entries = await db
    .select({ type: allowlist.type, value: allowlist.value })
    .from(allowlist)

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
      return new RegExp(entry.value).test(normalizedEmail)
    } catch {
      return false
    }
  })
}

export function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null
}

export function isValidAllowlistPattern(value: string) {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}
