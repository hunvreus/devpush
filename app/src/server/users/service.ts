import { withWorkspaceAccess } from '#devpush/server/plugins/workspace-access'
import { PublicError } from '#devpush/lib/public-error'
import { leaveMembership } from '#devpush/server/teams/membership'
import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm'

import { authMethods } from '#devpush/server/auth/better-auth'
import { getGitHubOAuthCredentials } from '#devpush/server/auth/auth-methods'
import type { TeamRole } from '#devpush/lib/team-role'
import { deleteUserState, cleanupDeletedUserState } from './deletion-state'
import type { UserCleanupJobPayload } from './deletion-state'
import { db } from '#devpush/server/db'
import {
  account,
  teamMembers,
  teams,
  user,
  userCleanupJobs,
} from '#devpush/server/db/schema'
import { getResourceColor } from '#devpush/server/resources/color'
import { assertOtherOwner } from '#devpush/server/teams/service'
import {
  removeOwnedAvatar,
  resolveAvatarUpdate,
} from '#devpush/server/uploads/avatar'

export type AuthAccountSummary = {
  id: string
  accountId: string
  providerId: string
  managementUrl: string | null
  providerAccountName: string | null
  providerAccountEmail: string | null
  providerAccountUsername: string | null
  providerAccountImage: string | null
}

export type UserTeamSummary = {
  id: string
  slug: string
  name: string
  image: string | null
  role: TeamRole
  isDefault: boolean
  color: ReturnType<typeof getResourceColor>
}

type AuthAccountRow = Omit<AuthAccountSummary, 'managementUrl'>

export async function updateUserGeneral({
  settingsVersion,
  userId,
  name,
  username,
  avatarDataUrl,
  deleteAvatar,
  confirmProfile = false,
}: {
  settingsVersion?: number
  userId: string
  name: string
  username: string
  avatarDataUrl?: string | null
  deleteAvatar?: boolean
  confirmProfile?: boolean
}) {
  const rows = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  const currentUser = rows.at(0)

  if (!currentUser || currentUser.status !== 'active') {
    throw new PublicError('ACCOUNT_NOT_FOUND')
  }

  const expectedVersion = settingsVersion ?? currentUser.settingsVersion
  if (expectedVersion !== currentUser.settingsVersion)
    throw new PublicError('SETTINGS_CONFLICT')
  const normalizedName = name.trim()
  const normalizedUsername = validateUsername(username)

  if (!normalizedName) {
    throw new PublicError('ACCOUNT_NAME_REQUIRED')
  }

  const usernameRows = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        sql`lower(${user.username}) = ${normalizedUsername.toLowerCase()}`,
        eq(user.status, 'active'),
        sql`${user.id} <> ${userId}`,
      ),
    )
    .limit(1)

  if (usernameRows.length > 0) {
    throw new PublicError('ACCOUNT_USERNAME_CONFLICT')
  }

  const image = await resolveAvatarUpdate({
    filePrefix: 'user',
    resourceId: userId,
    currentAvatarPath: currentUser.image,
    avatarDataUrl,
    deleteAvatar: deleteAvatar ?? false,
  })

  try {
    const changed = await db
      .update(user)
      .set({
        ...(confirmProfile ? { profileConfirmedAt: new Date() } : {}),
        name: normalizedName,
        username: normalizedUsername,
        image,
        settingsVersion: sql`${user.settingsVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(user.id, userId),
          eq(user.status, 'active'),
          eq(user.settingsVersion, expectedVersion),
          sql`${user.image} is ${currentUser.image}`,
        ),
      )
      .returning({ id: user.id })
    if (!changed.length) throw new PublicError('SETTINGS_CONFLICT')
  } catch (error) {
    if (image && image !== currentUser.image) {
      await removeOwnedAvatar(image, { filePrefix: 'user', resourceId: userId })
    }

    throw error
  }

  if (currentUser.image !== image) {
    await removeOwnedAvatar(currentUser.image, {
      filePrefix: 'user',
      resourceId: userId,
    })
  }
  return {
    settingsVersion: expectedVersion + 1,
    id: userId,
    name: normalizedName,
    username: normalizedUsername,
    image,
  }
}

export async function listAuthAccounts(
  userId: string,
  { validateUser = true }: { validateUser?: boolean } = {},
): Promise<Array<AuthAccountSummary>> {
  const rows = await listAuthAccountRows(userId, { validateUser })

  return rows.map(mapAuthAccountSummary)
}

async function listAuthAccountRows(
  userId: string,
  { validateUser = true }: { validateUser?: boolean } = {},
): Promise<Array<AuthAccountRow>> {
  if (validateUser) {
    await assertActiveUser(userId)
  }

  const rows = await db
    .select({
      id: account.id,
      accountId: account.accountId,
      providerId: account.providerId,
      providerAccountName: account.providerAccountName,
      providerAccountEmail: account.providerAccountEmail,
      providerAccountUsername: account.providerAccountUsername,
      providerAccountImage: account.providerAccountImage,
    })
    .from(account)
    .where(eq(account.userId, userId))
    .orderBy(desc(account.createdAt))

  return rows
}

export async function assertActiveUser(userId: string) {
  const rows = await db
    .select({ status: user.status })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const currentUser = rows.at(0)

  if (!currentUser || currentUser.status !== 'active') {
    throw new PublicError('ACCOUNT_NOT_FOUND')
  }
}

export function mapAuthAccountSummary(row: AuthAccountRow): AuthAccountSummary {
  return {
    id: row.id,
    accountId: row.accountId,
    providerId: row.providerId,
    managementUrl: getProviderManagementUrl(row.providerId),
    providerAccountName: row.providerAccountName,
    providerAccountEmail: row.providerAccountEmail,
    providerAccountUsername: row.providerAccountUsername,
    providerAccountImage: row.providerAccountImage,
  }
}

function getProviderManagementUrl(providerId: string) {
  if (providerId === 'github') {
    const credentials = getGitHubOAuthCredentials()

    if (!credentials) {
      return null
    }

    return `https://github.com/settings/connections/applications/${credentials.clientId}`
  }

  if (providerId === 'google') {
    return 'https://myaccount.google.com/connections'
  }

  return null
}

export async function disconnectAuthAccount({
  userId,
  providerId,
  accountId,
}: {
  userId: string
  providerId: string
  accountId?: string | null
}) {
  const accounts = await listAuthAccounts(userId)
  const selectedAccount = accounts.find((candidate) =>
    accountId
      ? candidate.providerId === providerId && candidate.accountId === accountId
      : candidate.providerId === providerId,
  )

  if (!selectedAccount) {
    throw new PublicError('AUTH_ACCOUNT_NOT_FOUND')
  }

  if (!authMethods.email && accounts.length <= 1) {
    throw new PublicError('ACCOUNT_LAST_SIGN_IN_METHOD')
  }

  await db
    .delete(account)
    .where(and(eq(account.id, selectedAccount.id), eq(account.userId, userId)))

  return listAuthAccounts(userId)
}

export async function listUserTeams(
  userId: string,
): Promise<Array<UserTeamSummary>> {
  const rows = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      image: teams.avatarPath,
      role: teamMembers.role,
      defaultTeamId: user.defaultTeamId,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teams.status, 'active'),
        eq(user.status, 'active'),
      ),
    )
    .orderBy(desc(teams.updatedAt))

  return rows.map((team) => ({
    id: team.id,
    slug: team.slug,
    name: team.name,
    image: team.image,
    role: team.role,
    isDefault: team.id === team.defaultTeamId,
    color: getResourceColor(team.id),
  }))
}

export async function leaveTeam({
  userId,
  teamId,
}: {
  userId: string
  teamId: string
}) {
  const [currentUser] = await db
    .select({ defaultTeamId: user.defaultTeamId, status: user.status })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!currentUser || currentUser.status !== 'active')
    throw new PublicError('ACCOUNT_NOT_FOUND')
  if (currentUser.defaultTeamId === teamId)
    throw new PublicError('ACCOUNT_DEFAULT_TEAM_LEAVE_FORBIDDEN')
  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)))
    .limit(1)
  if (!membership) throw new PublicError('ACCOUNT_MEMBERSHIP_NOT_FOUND')
  if (membership.role === 'owner') await assertOtherOwner(db, teamId, userId)
  if (
    !(await withWorkspaceAccess(
      teamId,
      'workspace.leave',
      () => leaveMembership(db, { userId, teamId }),
      { kind: 'user', userId },
    ))
  ) {
    throw new PublicError('TEAM_MEMBERSHIP_CHANGED')
  }

  return listUserTeams(userId)
}

export async function deleteUserAccount(input: {
  userId: string
  confirmationName?: string
}) {
  return queueUserDeletion({
    userId: input.userId,
    confirmationName: input.confirmationName,
  })
}

// Admin deletion has a distinct authorization guard; it does not impersonate
// the target user's self-service email confirmation.
export async function deleteUserAccountAsAdmin(input: {
  userId: string
  adminActorUserId: string
}) {
  return queueUserDeletion(input)
}

async function queueUserDeletion({
  userId,
  confirmationName,
  adminActorUserId,
}: {
  userId: string
  confirmationName?: string
  adminActorUserId?: string
}) {
  const rows = await db
    .select({ email: user.email, image: user.image, status: user.status })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const currentUser = rows.at(0)

  if (
    !currentUser ||
    !(
      currentUser.status === 'active' ||
      (adminActorUserId && currentUser.status === 'banned')
    )
  ) {
    throw new PublicError('ACCOUNT_NOT_FOUND')
  }

  if (!adminActorUserId && confirmationName !== currentUser.email) {
    throw new PublicError('ACCOUNT_DELETE_CONFIRMATION')
  }

  const soleMemberOwnedTeams = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(
      and(
        eq(teams.status, 'active'),
        inArray(
          teams.id,
          db
            .select({ id: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, userId)),
        ),
      ),
    )
    .groupBy(teams.id)
    .having(
      sql`count(${teamMembers.id}) = 1 and max(case when ${teamMembers.userId} = ${userId} and ${teamMembers.role} = 'owner' then 1 else 0 end) = 1`,
    )
  const soleMemberOwnedTeamIds = soleMemberOwnedTeams.map((team) => team.id)
  const soleMemberOwnedTeamIdSet = new Set(soleMemberOwnedTeamIds)

  const remainingOwnerRows = await db
    .select({ teamId: teamMembers.teamId, teamName: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, 'owner'),
        eq(teams.status, 'active'),
      ),
    )

  for (const membership of remainingOwnerRows) {
    if (soleMemberOwnedTeamIdSet.has(membership.teamId)) {
      continue
    }
    try {
      await assertOtherOwner(db, membership.teamId, userId)
    } catch (error) {
      if (error instanceof PublicError && error.code === 'TEAM_LAST_OWNER') {
        throw new PublicError('ACCOUNT_OWNERSHIP_TRANSFER_REQUIRED')
      }

      throw error
    }
  }

  if (
    !(await deleteUserState(db, {
      userId,
      email: currentUser.email,
      now: new Date(),
      adminActorUserId,
    }))
  )
    throw new PublicError('ACCOUNT_STATE_CHANGED')
}

export async function runQueuedUserCleanupJobs({
  limit = 10,
  now = new Date(),
}: {
  limit?: number
  now?: Date
} = {}) {
  const eligible = or(
    and(
      eq(userCleanupJobs.status, 'queued'),
      lte(userCleanupJobs.availableAt, now),
    ),
    and(
      eq(userCleanupJobs.status, 'running'),
      sql`coalesce(${userCleanupJobs.claimedAt}, ${userCleanupJobs.updatedAt}) <= ${now.getTime() - 10 * 60_000}`,
    ),
  )
  const rows = await db
    .select({
      id: userCleanupJobs.id,
      attempt: userCleanupJobs.attempt,
      maxAttempts: userCleanupJobs.maxAttempts,
      payload: userCleanupJobs.payload,
    })
    .from(userCleanupJobs)
    .where(eligible)
    .orderBy(asc(userCleanupJobs.availableAt))
    .limit(limit)

  const results: Array<{
    id: string
    status: 'succeeded' | 'failed' | 'queued'
  }> = []

  for (const row of rows) {
    if (row.attempt >= row.maxAttempts) {
      const failed = await db
        .update(userCleanupJobs)
        .set({
          status: 'failed',
          errorMessage:
            'Cleanup retry limit reached after an interrupted attempt.',
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(userCleanupJobs.id, row.id),
            eq(userCleanupJobs.attempt, row.attempt),
            eligible,
          ),
        )
        .returning({ id: userCleanupJobs.id })
      if (failed.length) results.push({ id: row.id, status: 'failed' })
      continue
    }
    const claimedRows = await db
      .update(userCleanupJobs)
      .set({
        status: 'running',
        attempt: row.attempt + 1,
        claimedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(userCleanupJobs.id, row.id),
          eq(userCleanupJobs.attempt, row.attempt),
          eligible,
        ),
      )
      .returning({
        id: userCleanupJobs.id,
        attempt: userCleanupJobs.attempt,
        maxAttempts: userCleanupJobs.maxAttempts,
        payload: userCleanupJobs.payload,
      })
    const claimed = claimedRows.at(0)

    if (!claimed) {
      continue
    }
    const ownsClaim = and(
      eq(userCleanupJobs.id, claimed.id),
      eq(userCleanupJobs.status, 'running'),
      eq(userCleanupJobs.attempt, claimed.attempt),
      eq(userCleanupJobs.claimedAt, now),
    )

    try {
      const payload = parseUserCleanupJobPayload(claimed.payload)
      const avatarPaths = await cleanupDeletedUserResources({
        payload,
        now,
        claim: { id: claimed.id, attempt: claimed.attempt },
      })

      await Promise.all(
        avatarPaths.map((avatarPath) =>
          removeOwnedAvatar(
            avatarPath,
            {
              filePrefix: 'user',
              resourceId: payload.userId,
            },
            { strict: true },
          ),
        ),
      )
      const finished = await db
        .update(userCleanupJobs)
        .set({
          status: 'succeeded',
          errorMessage: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(ownsClaim)
        .returning({ id: userCleanupJobs.id })
      if (finished.length) results.push({ id: claimed.id, status: 'succeeded' })
    } catch (error) {
      const canRetry = claimed.attempt < claimed.maxAttempts
      const nextAvailableAt = new Date(now.getTime() + 60_000)

      const retried = await db
        .update(userCleanupJobs)
        .set({
          status: canRetry ? 'queued' : 'failed',
          errorMessage:
            error instanceof Error ? error.message : 'Unable to clean up user.',
          availableAt: canRetry ? nextAvailableAt : now,
          finishedAt: canRetry ? null : now,
          updatedAt: now,
        })
        .where(ownsClaim)
        .returning({ id: userCleanupJobs.id })

      if (retried.length)
        results.push({ id: claimed.id, status: canRetry ? 'queued' : 'failed' })
    }
  }

  return results
}

async function cleanupDeletedUserResources({
  payload,
  now,
  claim,
}: {
  payload: UserCleanupJobPayload
  now: Date
  claim: { id: string; attempt: number }
}) {
  await cleanupDeletedUserState(db, { payload, now, claim })

  return payload.avatarPath ? [payload.avatarPath] : []
}

function parseUserCleanupJobPayload(value: unknown): UserCleanupJobPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid user cleanup payload.')
  }

  const payload = value as Partial<UserCleanupJobPayload>

  if (
    payload.schemaVersion !== 1 ||
    typeof payload.userId !== 'string' ||
    typeof payload.email !== 'string' ||
    !Array.isArray(payload.soleMemberOwnedTeamIds) ||
    !payload.soleMemberOwnedTeamIds.every((item) => typeof item === 'string') ||
    (payload.avatarPath !== null && typeof payload.avatarPath !== 'string')
  ) {
    throw new Error('Invalid user cleanup payload.')
  }

  return {
    schemaVersion: 1,
    userId: payload.userId,
    email: payload.email,
    avatarPath: payload.avatarPath ?? null,
    soleMemberOwnedTeamIds: payload.soleMemberOwnedTeamIds,
  }
}

function validateUsername(value: string) {
  const normalizedUsername = value.trim()

  if (!normalizedUsername) {
    throw new PublicError('ACCOUNT_USERNAME_REQUIRED')
  }

  if (normalizedUsername.length > 50) {
    throw new PublicError('ACCOUNT_USERNAME_TOO_LONG')
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/.test(normalizedUsername)) {
    throw new PublicError('ACCOUNT_USERNAME_INVALID')
  }

  return normalizedUsername
}
