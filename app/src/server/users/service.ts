import { leaveMembership } from '@/server/teams/membership'
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm'
import { decodeJwt } from 'jose'

import { authMethods } from '@/lib/auth'
import { getGitHubOAuthCredentials } from '@/lib/auth/config'
import type { TeamRole } from '@/lib/team-role'
import { deleteUserState, cleanupDeletedUserState } from './deletion-state'
import type { UserCleanupJobPayload } from './deletion-state'
import { db } from '@/server/db'
import {
  account,
  teamMembers,
  teams,
  user,
  userCleanupJobs,
} from '@/server/db/schema'
import { getResourceColor } from '@/server/resources/color'
import { assertOtherOwner } from '@/server/teams/service'
import { removePublicFile, resolveAvatarUpdate } from '@/server/uploads/avatar'

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

type AuthAccountRow = Omit<AuthAccountSummary, 'managementUrl'> & {
  accessToken?: string | null
  refreshToken?: string | null
  idToken?: string | null
}

type ProviderIdentity = {
  name?: string | null
  email?: string | null
  username?: string | null
  image?: string | null
}

type GitHubProfile = {
  id: number | string
  login?: string | null
  name?: string | null
  email?: string | null
  avatar_url?: string | null
}

type GitHubEmail = {
  email: string
  primary: boolean
  verified: boolean
}

export async function updateUserGeneral({
  userId,
  name,
  username,
  avatarDataUrl,
  deleteAvatar,
}: {
  userId: string
  name: string
  username: string
  avatarDataUrl?: string | null
  deleteAvatar?: boolean
}) {
  const rows = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  const currentUser = rows.at(0)

  if (!currentUser || currentUser.status !== 'active') {
    throw new Error('User not found.')
  }

  const normalizedName = name.trim()
  const normalizedUsername = validateUsername(username)

  if (!normalizedName) {
    throw new Error('Name is required.')
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
    throw new Error('Username is already taken.')
  }

  const image = await resolveAvatarUpdate({
    filePrefix: 'user',
    resourceId: userId,
    currentAvatarPath: currentUser.image,
    avatarDataUrl,
    deleteAvatar: deleteAvatar ?? false,
  })

  try {
    await db
      .update(user)
      .set({
        name: normalizedName,
        username: normalizedUsername,
        image,
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId))
  } catch (error) {
    if (image && image !== currentUser.image) {
      await removePublicFile(image)
    }

    throw error
  }

  return {
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

export async function backfillAuthAccountIdentities({
  userId,
  fetcher = fetch,
}: {
  userId: string
  fetcher?: typeof fetch
}): Promise<Array<AuthAccountSummary>> {
  const rows = await listAuthAccountRows(userId)
  const accountsToUpdate = rows.filter(shouldBackfillAuthAccount)

  for (const row of accountsToUpdate) {
    const identity = await getProviderIdentityForBackfill(row, fetcher)

    if (!identity) {
      continue
    }

    await db
      .update(account)
      .set({
        providerAccountName: row.providerAccountName ?? identity.name ?? null,
        providerAccountEmail:
          row.providerAccountEmail ?? identity.email ?? null,
        providerAccountUsername:
          row.providerAccountUsername ?? identity.username ?? null,
        providerAccountImage:
          row.providerAccountImage ?? identity.image ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(account.id, row.id), eq(account.userId, userId)))
  }

  return listAuthAccounts(userId)
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
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      idToken: account.idToken,
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
    throw new Error('User not found.')
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

function shouldBackfillAuthAccount(row: AuthAccountRow) {
  return (
    !row.providerAccountName ||
    !row.providerAccountEmail ||
    !row.providerAccountUsername ||
    !row.providerAccountImage
  )
}

async function getProviderIdentityForBackfill(
  row: AuthAccountRow,
  fetcher: typeof fetch,
): Promise<ProviderIdentity | null> {
  if (row.providerId === 'github') {
    return getGitHubIdentityForBackfill(row.accessToken, fetcher)
  }

  if (row.providerId === 'google') {
    return getGoogleIdentityForBackfill(row.idToken)
  }

  return null
}

async function getGitHubIdentityForBackfill(
  accessToken: string | null | undefined,
  fetcher: typeof fetch,
): Promise<ProviderIdentity | null> {
  if (!accessToken) {
    return null
  }

  const userResponse = await fetcher('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'devpush',
    },
  })

  if (!userResponse.ok) {
    return null
  }

  const profile = (await userResponse.json()) as GitHubProfile
  let email = profile.email ?? null

  const emailsResponse = await fetcher('https://api.github.com/user/emails', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'devpush',
    },
  })

  if (emailsResponse.ok) {
    const emails = (await emailsResponse.json()) as Array<GitHubEmail>
    const primaryEmail =
      emails.find((candidate) => candidate.primary && candidate.verified) ??
      emails.find((candidate) => candidate.primary) ??
      emails.at(0)
    email = email ?? primaryEmail?.email ?? null
  }

  return {
    name: profile.name ?? profile.login ?? null,
    email,
    username: profile.login ?? null,
    image: profile.avatar_url ?? null,
  }
}

function getGoogleIdentityForBackfill(
  idToken: string | null | undefined,
): ProviderIdentity | null {
  if (!idToken) {
    return null
  }

  try {
    const claims = decodeJwt(idToken)
    const email = getStringClaim(claims.email)

    return {
      name: getStringClaim(claims.name) ?? email ?? null,
      email: email ?? null,
      username: email ?? null,
      image: getStringClaim(claims.picture) ?? null,
    }
  } catch {
    return null
  }
}

function getStringClaim(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
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
    throw new Error('Account not found.')
  }

  if (!authMethods.email && accounts.length <= 1) {
    throw new Error(
      'Connect another sign-in method before disconnecting this account.',
    )
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
    throw new Error('User not found.')
  if (currentUser.defaultTeamId === teamId)
    throw new Error('You cannot leave your default team.')
  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)))
    .limit(1)
  if (!membership) throw new Error('Team membership not found.')
  if (membership.role === 'owner') await assertOtherOwner(db, teamId, userId)
  if (!(await leaveMembership(db, { userId, teamId }))) {
    throw new Error('Team membership changed. Try again.')
  }

  return listUserTeams(userId)
}

export async function deleteUserAccount({
  userId,
  confirmationName,
}: {
  userId: string
  confirmationName?: string
}) {
  const rows = await db
    .select({ email: user.email, image: user.image, status: user.status })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const currentUser = rows.at(0)

  if (!currentUser || currentUser.status !== 'active') {
    throw new Error('User not found.')
  }

  if (confirmationName !== currentUser.email) {
    throw new Error('Type the account email to confirm deletion.')
  }

  const soleMemberOwnedTeams = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(eq(teams.status, 'active'))
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
      if (
        error instanceof Error &&
        error.message === 'There must be at least one owner.'
      ) {
        throw new Error(
          `Transfer ownership of "${membership.teamName}" before deleting your account.`,
        )
      }

      throw error
    }
  }

  if (
    !(await deleteUserState(db, {
      userId,
      email: currentUser.email,
      now: new Date(),
    }))
  )
    throw new Error('Account or team ownership changed. Try again.')
}

export async function runQueuedUserCleanupJobs({
  limit = 10,
  now = new Date(),
}: {
  limit?: number
  now?: Date
} = {}) {
  const rows = await db
    .select({
      id: userCleanupJobs.id,
      attempt: userCleanupJobs.attempt,
      maxAttempts: userCleanupJobs.maxAttempts,
      payload: userCleanupJobs.payload,
    })
    .from(userCleanupJobs)
    .where(
      and(
        eq(userCleanupJobs.status, 'queued'),
        lte(userCleanupJobs.availableAt, now),
      ),
    )
    .orderBy(asc(userCleanupJobs.availableAt))
    .limit(limit)

  const results: Array<{
    id: string
    status: 'succeeded' | 'failed' | 'queued'
  }> = []

  for (const row of rows) {
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
          eq(userCleanupJobs.status, 'queued'),
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

    try {
      const avatarPaths = await cleanupDeletedUserResources({
        payload: parseUserCleanupJobPayload(claimed.payload),
        now,
      })

      await db
        .update(userCleanupJobs)
        .set({
          status: 'succeeded',
          errorMessage: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(userCleanupJobs.id, claimed.id))

      await Promise.all(
        avatarPaths.map((avatarPath) => removePublicFile(avatarPath)),
      )

      results.push({ id: claimed.id, status: 'succeeded' })
    } catch (error) {
      const canRetry = claimed.attempt < claimed.maxAttempts
      const nextAvailableAt = new Date(now.getTime() + 60_000)

      await db
        .update(userCleanupJobs)
        .set({
          status: canRetry ? 'queued' : 'failed',
          errorMessage:
            error instanceof Error ? error.message : 'Unable to clean up user.',
          availableAt: canRetry ? nextAvailableAt : now,
          finishedAt: canRetry ? null : now,
          updatedAt: now,
        })
        .where(eq(userCleanupJobs.id, claimed.id))

      results.push({ id: claimed.id, status: canRetry ? 'queued' : 'failed' })
    }
  }

  return results
}

async function cleanupDeletedUserResources({
  payload,
  now,
}: {
  payload: UserCleanupJobPayload
  now: Date
}) {
  await cleanupDeletedUserState(db, { payload, now })

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
    throw new Error('Username is required.')
  }

  if (normalizedUsername.length > 50) {
    throw new Error('Username must be 50 characters or fewer.')
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/.test(normalizedUsername)) {
    throw new Error(
      'Username must start and end with a letter or number and only use letters, numbers, dots, underscores hyphens.',
    )
  }

  return normalizedUsername
}
