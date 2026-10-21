import { withWorkspaceAccess } from '@/deployment/workspace-access'
import { PublicError, getPublicErrorMessage } from '@/lib/public-error'
import { toPublicError } from '@/server/http/public-errors'
import { bootstrapOwnedTeam, insertOwnedTeam } from './creation'
import { acceptInvitation } from './invitations'
import { mutateTeamMembership, mutateTeamOwnership } from './membership'
import { isUniqueConstraintError } from '@/server/db/errors'
import { and, count, desc, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm'

import { canManageTeamMembers, canManageTeamSettings } from '@/lib/team-role'
import type { TeamRole } from '@/lib/team-role'
import { config } from '@/server/config'
import { db } from '@/server/db'
import { deleteTeamState } from './deletion-state'
import { teamInvites, teamMembers, teams, user } from '@/server/db/schema'
import { sendTeamInviteEmail } from '@/server/email/service'
import { getResourceColor } from '@/server/resources/color'
import { removeOwnedAvatar, resolveAvatarUpdate } from '@/server/uploads/avatar'
import { canDeleteTeam } from './delete-policy'
import { isInstallationAdmin } from '@/server/admin/access'
import {
  listTeamInvites,
  listTeamMembers,
  listUserPendingTeamInvites,
} from './queries'
import type { TeamInviteSummary, TeamSummary, UserContext } from './types'

export type { TeamSummary, UserContext } from './types'

const forbiddenTeamSlugs = new Set([
  'admin',
  'api',
  'assets',
  'auth',
  'deployment-not-found',
  'health',
  'invites',
  'mcp',
  'new-team',
  'oauth',
  'settings',
  'setup',
  'upload',
  'uploads',
  'user',
])

export async function ensureUserBootstrap(userId: string) {
  const [currentUser] = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!currentUser || currentUser.status !== 'active')
    throw new PublicError('ACCOUNT_NOT_FOUND')
  const teamName =
    currentUser.name || currentUser.email.split('@')[0] || currentUser.email
  if (
    !(await bootstrapOwnedTeam(db, {
      userId,
      teamId: crypto.randomUUID(),
      name: teamName,
      baseSlug: slugify(teamName),
    }))
  )
    throw new PublicError('ACCOUNT_NOT_FOUND')
  const [updatedUser] = await db
    .select({ defaultTeamId: user.defaultTeamId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!updatedUser?.defaultTeamId) throw new Error('Team could not be created.')
  return updatedUser.defaultTeamId
}

export async function getUserContext(userId: string): Promise<UserContext> {
  const [currentUserRows, membershipRows, invites] = await Promise.all([
    db.select().from(user).where(eq(user.id, userId)).limit(1),
    listUserTeamMemberships(userId),
    listUserPendingTeamInvites(userId),
  ])
  let currentUser = currentUserRows.at(0)

  if (!currentUser || currentUser.status !== 'active') {
    throw new PublicError('ACCOUNT_NOT_FOUND')
  }

  let memberships = membershipRows

  // Account creation performs this bootstrap in the auth hook. Keep a recovery
  // path for old or partially-created accounts without writing on normal reads.
  if (memberships.length === 0) {
    await ensureUserBootstrap(userId)
    ;[currentUser, memberships] = await Promise.all([
      db
        .select()
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
        .then((rows) => rows.at(0)),
      listUserTeamMemberships(userId),
    ])
  }

  if (!currentUser || currentUser.status !== 'active') {
    throw new PublicError('ACCOUNT_NOT_FOUND')
  }

  if (memberships.length === 0) {
    throw new Error('User has no teams')
  }

  const mappedTeams = memberships.map((team) => ({
    ...team,
    color: getResourceColor(team.id),
  }))

  const defaultTeam =
    mappedTeams.find((team) => team.id === currentUser.defaultTeamId) ??
    mappedTeams[0]
  if (!defaultTeam) throw new Error('User has no teams')

  return {
    user: {
      profileConfirmedAt: currentUser.profileConfirmedAt?.getTime() ?? null,
      settingsVersion: currentUser.settingsVersion,
      id: currentUser.id,
      name: currentUser.name,
      username: currentUser.username,
      email: currentUser.email,
      image: currentUser.image,
      defaultTeamId: currentUser.defaultTeamId,
      isInstallationAdmin: await isInstallationAdmin({
        id: currentUser.id,
        email: currentUser.email,
      }),
    },
    teams: mappedTeams,
    defaultTeam,
    invites,
  }
}

function listUserTeamMemberships(userId: string) {
  return db
    .select({
      settingsVersion: teams.settingsVersion,
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      image: teams.avatarPath,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userId), eq(teams.status, 'active')))
    .orderBy(desc(teams.updatedAt))
}

export async function requireTeam(
  userId: string,
  teamSlug: string,
  teamId?: string,
) {
  const teamRows = await db
    .select({
      settingsVersion: teams.settingsVersion,
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      image: teams.avatarPath,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        teamId ? eq(teams.id, teamId) : eq(teams.slug, teamSlug),
        eq(teams.status, 'active'),
        eq(user.status, 'active'),
      ),
    )
    .limit(1)
  const team = teamRows.at(0)

  if (!team) {
    throw new PublicError('TEAM_NOT_FOUND')
  }

  return {
    ...team,
    color: getResourceColor(team.id),
  }
}

export async function requireTeamManager(userId: string, teamSlug: string) {
  const team = await requireTeam(userId, teamSlug)

  if (!canManageTeamSettings(team.role)) {
    throw new PublicError('FORBIDDEN')
  }

  return team
}

export async function createTeam({
  userId,
  name,
}: {
  userId: string
  name: string
}) {
  const normalizedName = name.trim()

  if (!normalizedName) {
    throw new PublicError('TEAM_NAME_REQUIRED')
  }

  const teamId = crypto.randomUUID()

  if (
    !(await insertOwnedTeam(db, {
      userId,
      teamId,
      name: normalizedName,
      baseSlug: slugify(normalizedName),
    }))
  )
    throw new PublicError('ACCOUNT_NOT_FOUND')

  const rows = await db
    .select({
      slug: teams.slug,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)
  const team = rows.at(0)

  if (!team) {
    throw new Error('Team could not be created.')
  }

  return requireTeam(userId, team.slug)
}

export async function getTeamDeletionStatus({ teamId }: { teamId: string }) {
  const defaultUserRows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.defaultTeamId, teamId), eq(user.status, 'active')))

  return {
    canDelete: canDeleteTeam({
      defaultUserIds: defaultUserRows.map((row) => row.id),
    }),
    defaultUserCount: defaultUserRows.length,
  }
}

export async function updateTeamGeneral({
  settingsVersion,
  teamId,
  userId,
  teamSlug,
  name,
  slug,
  avatarDataUrl,
  deleteAvatar,
}: {
  settingsVersion?: number
  teamId?: string
  userId: string
  teamSlug: string
  name: string
  slug: string
  avatarDataUrl?: string | null
  deleteAvatar?: boolean
}) {
  const team = await requireTeam(userId, teamSlug, teamId)
  requireAdminRole(team.role)

  const expectedVersion = settingsVersion ?? team.settingsVersion
  if (expectedVersion !== team.settingsVersion)
    throw new PublicError(
      'SETTINGS_CONFLICT',
      `/${encodeURIComponent(team.slug)}/settings`,
    )
  const normalizedName = name.trim()
  const normalizedSlug = normalizeTeamSlug(slug)

  if (!normalizedName) {
    throw new PublicError('TEAM_NAME_REQUIRED')
  }

  if (forbiddenTeamSlugs.has(normalizedSlug)) {
    throw new PublicError('TEAM_SLUG_RESERVED')
  }

  const avatarPath = await resolveAvatarUpdate({
    filePrefix: 'team',
    resourceId: team.id,
    currentAvatarPath: team.image,
    avatarDataUrl,
    deleteAvatar: deleteAvatar ?? false,
  })

  try {
    const changed = await db
      .update(teams)
      .set({
        name: normalizedName,
        slug: normalizedSlug,
        avatarPath,
        settingsVersion: sql`${teams.settingsVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(teams.id, team.id),
          eq(teams.status, 'active'),
          eq(teams.settingsVersion, expectedVersion),
          sql`${teams.avatarPath} is ${team.image}`,
          sql`exists(select 1 from team_members m join user u on u.id = m.user_id where m.team_id = ${team.id} and m.user_id = ${userId} and m.role in ('owner','admin') and u.status = 'active')`,
        ),
      )
      .returning({ id: teams.id })
    if (!changed.length)
      throw new PublicError(
        'SETTINGS_CONFLICT',
        `/${encodeURIComponent(team.slug)}/settings`,
      )
  } catch (error) {
    if (avatarPath && avatarPath !== team.image) {
      await removeOwnedAvatar(avatarPath, {
        filePrefix: 'team',
        resourceId: team.id,
      })
    }

    if (isUniqueConstraintError(error))
      throw new PublicError('TEAM_SLUG_CONFLICT')
    throw error
  }

  if (team.image !== avatarPath) {
    await removeOwnedAvatar(team.image, {
      filePrefix: 'team',
      resourceId: team.id,
    })
  }

  return requireTeam(userId, normalizedSlug)
}

export async function createTeamInvites({
  userId,
  teamSlug,
  emails,
  role,
}: {
  userId: string
  teamSlug: string
  emails: Array<string>
  role: Exclude<TeamRole, 'owner'>
}) {
  if (emails.length === 0) {
    throw new PublicError('TEAM_INVITE_EMAIL_REQUIRED')
  }

  const team = await requireTeam(userId, teamSlug)
  requireAdminRole(team.role)

  await withWorkspaceAccess(team.id, 'member.invite', async () => undefined)

  let emailCount = 0
  const failedEmails: Array<{ email: string; message: string }> = []
  let emailSentCount = 0
  let inviteUrl: string | null = null
  let invites: Array<TeamInviteSummary> = []

  for (const email of emails) {
    try {
      const result = await upsertTeamInvite({ userId, team, email, role })
      emailCount += 1
      if (result.emailSent) emailSentCount += 1
      inviteUrl = result.inviteUrl
      invites = result.invites
    } catch (error) {
      failedEmails.push({
        email,
        message: getPublicErrorMessage(
          toPublicError(error),
          'Unable to create this invitation. Please try again.',
        ),
      })
    }
  }

  return {
    emailCount,
    failedEmails,
    emailSentCount,
    inviteUrl,
    invites,
  }
}

export async function resendTeamInvite({
  userId,
  teamSlug,
  inviteId,
}: {
  userId: string
  teamSlug: string
  inviteId: string
}) {
  const team = await requireTeam(userId, teamSlug)
  requireAdminRole(team.role)

  await withWorkspaceAccess(team.id, 'member.invite', async () => undefined)
  const rows = await db
    .select()
    .from(teamInvites)
    .where(
      and(
        eq(teamInvites.id, inviteId),
        eq(teamInvites.teamId, team.id),
        eq(teamInvites.status, 'pending'),
      ),
    )
    .limit(1)
  const invite = rows.at(0)

  if (!invite) {
    throw new PublicError('TEAM_INVITE_NOT_FOUND')
  }

  return upsertTeamInvite({
    userId,
    team,
    email: invite.email,
    role: invite.role === 'admin' ? 'admin' : 'member',
    existingInviteId: invite.id,
  })
}

export async function revokeTeamInvite({
  userId,
  teamSlug,
  inviteId,
}: {
  userId: string
  teamSlug: string
  inviteId: string
}) {
  const team = await requireTeam(userId, teamSlug)
  requireAdminRole(team.role)

  const revokedRows = await db
    .update(teamInvites)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(
      and(
        eq(teamInvites.id, inviteId),
        eq(teamInvites.teamId, team.id),
        eq(teamInvites.status, 'pending'),
      ),
    )
    .returning({ id: teamInvites.id })

  if (!revokedRows.at(0)) {
    throw new PublicError('TEAM_INVITE_NOT_FOUND')
  }

  return listTeamInvites(team.id)
}

export async function cleanupExpiredTeamInvites({
  now = new Date(),
}: {
  now?: Date
} = {}) {
  const rows = await db
    .update(teamInvites)
    .set({
      status: 'expired',
      updatedAt: now,
    })
    .where(
      and(eq(teamInvites.status, 'pending'), lte(teamInvites.expiresAt, now)),
    )
    .returning({ id: teamInvites.id })

  return {
    expiredCount: rows.length,
    expiredInviteIds: rows.map((row) => row.id),
  }
}

export async function updateTeamMemberRole({
  userId,
  teamSlug,
  memberUserId,
  role,
}: {
  userId: string
  teamSlug: string
  memberUserId: string
  role: TeamRole
}) {
  const team = await requireTeam(userId, teamSlug)
  requireMemberManagerRole(team.role)

  const memberRows = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, team.id),
        eq(teamMembers.userId, memberUserId),
      ),
    )
    .limit(1)
  const member = memberRows.at(0)

  if (!member) {
    throw new PublicError('TEAM_MEMBER_NOT_FOUND')
  }

  if (team.role !== 'owner' && (member.role === 'owner' || role === 'owner')) {
    throw new PublicError('TEAM_OWNER_ROLE_FORBIDDEN')
  }

  const changed = await mutateTeamMembership(db, {
    teamId: team.id,
    actorId: userId,
    memberId: memberUserId,
    action: 'role',
    role,
  })
  if (!changed) {
    await throwMembershipChangeError({ userId, teamSlug, memberUserId, role })
  }

  return listTeamMembers(team.id)
}

export async function removeTeamMember({
  userId,
  teamSlug,
  memberUserId,
}: {
  userId: string
  teamSlug: string
  memberUserId: string
}) {
  const team = await requireTeam(userId, teamSlug)
  requireMemberManagerRole(team.role)

  const memberRows = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, team.id),
        eq(teamMembers.userId, memberUserId),
      ),
    )
    .limit(1)
  const member = memberRows.at(0)

  if (!member) {
    throw new PublicError('TEAM_MEMBER_NOT_FOUND')
  }

  if (team.role !== 'owner' && member.role === 'owner') {
    throw new PublicError('TEAM_OWNER_REMOVAL_FORBIDDEN')
  }

  const changed = await mutateTeamMembership(db, {
    teamId: team.id,
    actorId: userId,
    memberId: memberUserId,
    action: 'remove',
  })
  if (!changed) {
    await throwMembershipChangeError({
      userId,
      teamSlug,
      memberUserId,
      role: null,
    })
  }

  return listTeamMembers(team.id)
}

async function throwMembershipChangeError({
  userId,
  teamSlug,
  memberUserId,
  role,
}: {
  userId: string
  teamSlug: string
  memberUserId: string
  role: TeamRole | null
}): Promise<never> {
  const team = await requireTeam(userId, teamSlug)
  requireMemberManagerRole(team.role)
  const [member] = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, team.id),
        eq(teamMembers.userId, memberUserId),
      ),
    )
    .limit(1)
  if (!member) throw new PublicError('TEAM_MEMBER_NOT_FOUND')
  if (team.role !== 'owner' && (member.role === 'owner' || role === 'owner')) {
    throw new PublicError(
      role === null
        ? 'TEAM_OWNER_REMOVAL_FORBIDDEN'
        : 'TEAM_OWNER_ROLE_FORBIDDEN',
    )
  }
  if (member.role === 'owner' && role !== 'owner')
    throw new PublicError('TEAM_LAST_OWNER')
  throw new PublicError('TEAM_MEMBERSHIP_CHANGED')
}

export async function transferTeamOwnership({
  userId,
  teamSlug,
  memberUserId,
}: {
  userId: string
  teamSlug: string
  memberUserId: string
}) {
  const team = await requireTeam(userId, teamSlug)
  requireOwnerRole(team.role)

  if (userId === memberUserId) {
    throw new PublicError('TEAM_TRANSFER_MEMBER_REQUIRED')
  }

  const memberRows = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, team.id),
        inArray(teamMembers.userId, [userId, memberUserId]),
      ),
    )
  const memberships = new Map(
    memberRows.map((member) => [member.userId, member]),
  )
  const currentMembership = memberships.get(userId)
  const targetMembership = memberships.get(memberUserId)

  if (!currentMembership || currentMembership.role !== 'owner') {
    throw new PublicError('TEAM_TRANSFER_FORBIDDEN')
  }

  if (!targetMembership) {
    throw new PublicError('TEAM_MEMBER_NOT_FOUND')
  }

  if (targetMembership.role === 'owner') {
    throw new PublicError('TEAM_MEMBER_ALREADY_OWNER')
  }

  if (
    !(await mutateTeamOwnership(db, {
      teamId: team.id,
      actorId: userId,
      memberId: memberUserId,
    }))
  ) {
    throw new PublicError('TEAM_MEMBERSHIP_CHANGED')
  }

  return listTeamMembers(team.id)
}

export async function deleteTeam({
  userId,
  teamSlug,
  confirmationName,
}: {
  confirmationName?: string
  userId: string
  teamSlug: string
}) {
  const team = await requireTeam(userId, teamSlug)
  requireOwnerRole(team.role)

  if (confirmationName !== team.slug) {
    throw new PublicError('TEAM_DELETE_CONFIRMATION')
  }

  const defaultUserRows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.defaultTeamId, team.id), eq(user.status, 'active')))
  if (
    !canDeleteTeam({
      defaultUserIds: defaultUserRows.map((row) => row.id),
    })
  )
    throw new PublicError('TEAM_DEFAULT_DELETE_FORBIDDEN')
  if (
    !(await deleteTeamState(db, {
      teamId: team.id,
      userId,
      now: new Date(),
    }))
  )
    throw new PublicError('TEAM_STATE_CHANGED')
}

export async function acceptTeamInvite({
  userId,
  token,
}: {
  userId: string
  token: string
}) {
  return acceptPendingInvitation(
    userId,
    eq(teamInvites.tokenHash, await hashToken(token)),
  )
}

export async function acceptUserTeamInvite({
  userId,
  inviteId,
}: {
  userId: string
  inviteId: string
}) {
  return acceptPendingInvitation(userId, eq(teamInvites.id, inviteId))
}

async function acceptPendingInvitation(
  userId: string,
  selector: ReturnType<typeof eq>,
) {
  const now = new Date()
  const [currentUser] = await db
    .select({
      email: user.email,
      emailVerified: user.emailVerified,
      status: user.status,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!currentUser || currentUser.status !== 'active')
    throw new PublicError('ACCOUNT_NOT_FOUND')

  const [row] = await db
    .select({ invite: teamInvites, teamSlug: teams.slug })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .where(
      and(
        selector,
        eq(teamInvites.status, 'pending'),
        eq(teams.status, 'active'),
      ),
    )
    .limit(1)
  if (!row || row.invite.expiresAt <= now)
    throw new PublicError('TEAM_INVITATION_INVALID')
  if (normalizeEmail(currentUser.email) !== row.invite.email) {
    throw new PublicError('TEAM_INVITATION_EMAIL_MISMATCH')
  }
  if (!currentUser.emailVerified) {
    throw new PublicError('TEAM_INVITATION_EMAIL_UNVERIFIED')
  }

  if (
    !(await withWorkspaceAccess(row.invite.teamId, 'member.accept', () =>
      acceptInvitation(db, {
        userId,
        inviteId: row.invite.id,
        tokenHash: row.invite.tokenHash,
        now,
      }),
    ))
  )
    throw new PublicError('TEAM_INVITATION_INVALID')
  return row.teamSlug
}

export async function declineUserTeamInvite({
  userId,
  inviteId,
}: {
  userId: string
  inviteId: string
}) {
  return declinePendingInvitation(userId, eq(teamInvites.id, inviteId))
}

export async function declineTeamInvite({
  userId,
  token,
}: {
  userId: string
  token: string
}) {
  return declinePendingInvitation(
    userId,
    eq(teamInvites.tokenHash, await hashToken(token)),
  )
}

async function declinePendingInvitation(
  userId: string,
  selector: ReturnType<typeof eq>,
) {
  const declined = await db
    .delete(teamInvites)
    .where(
      and(
        selector,
        eq(teamInvites.status, 'pending'),
        gt(teamInvites.expiresAt, new Date()),
        sql`exists(select 1 from ${user} where ${user.id} = ${userId} and ${user.status} = 'active' and ${user.emailVerified} = 1 and lower(trim(${user.email})) = ${teamInvites.email})`,
        sql`exists(select 1 from ${teams} where ${teams.id} = ${teamInvites.teamId} and ${teams.status} = 'active')`,
      ),
    )
    .returning({ id: teamInvites.id })
  if (!declined.length) throw new PublicError('TEAM_INVITATION_INVALID')
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '')

  return slug && !forbiddenTeamSlugs.has(slug) ? slug : 'team'
}

async function upsertTeamInvite({
  userId,
  team,
  email,
  role,
  existingInviteId,
}: {
  userId: string
  team: TeamSummary
  email: string
  role: Exclude<TeamRole, 'owner'>
  existingInviteId?: string
}) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    throw new PublicError('TEAM_EMAIL_REQUIRED')
  }

  const existingMemberRows = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, team.id),
        eq(user.status, 'active'),
        sql`lower(${user.email}) = ${normalizedEmail}`,
      ),
    )
    .limit(1)

  if (existingMemberRows.length > 0) {
    throw new PublicError('TEAM_ALREADY_MEMBER')
  }

  const { token, tokenHash } = await createInviteToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const now = new Date()
  const newInviteId = crypto.randomUUID()
  let inviteId = existingInviteId ?? newInviteId
  let shouldUpdateInvite = Boolean(existingInviteId)

  if (!existingInviteId) {
    const pendingInviteRows = await db
      .select({
        id: teamInvites.id,
        expiresAt: teamInvites.expiresAt,
      })
      .from(teamInvites)
      .where(
        and(
          eq(teamInvites.teamId, team.id),
          eq(teamInvites.status, 'pending'),
          sql`lower(${teamInvites.email}) = ${normalizedEmail}`,
        ),
      )
      .limit(1)
    const pendingInvite = pendingInviteRows.at(0)

    if (pendingInvite) {
      if (pendingInvite.expiresAt > now) {
        throw new PublicError('TEAM_INVITATION_ALREADY_SENT')
      }

      inviteId = pendingInvite.id
      shouldUpdateInvite = true
    }
  }

  try {
    if (shouldUpdateInvite) {
      const updated = await db
        .update(teamInvites)
        .set({
          role,
          tokenHash,
          expiresAt,
          inviterId: userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(teamInvites.id, inviteId),
            eq(teamInvites.status, 'pending'),
            sql`exists(select 1 from team_members m join user u on u.id = m.user_id join teams t on t.id = m.team_id
            where m.user_id = ${userId} and m.team_id = ${team.id} and m.role in ('owner','admin') and u.status = 'active' and t.status = 'active')`,
          ),
        )
        .returning({ id: teamInvites.id })
      if (updated.length === 0) throw new PublicError('TEAM_INVITE_NOT_FOUND')
    } else {
      await db.insert(teamInvites).values({
        id: inviteId,
        teamId: team.id,
        email: normalizedEmail,
        role,
        inviterId: userId,
        tokenHash,
        expiresAt,
      })
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    throw new PublicError('TEAM_INVITATION_ALREADY_SENT')
  }

  const inviteUrl = new URL(
    `/invites/${token}`,
    config.DEVPUSH_BASE_URL,
  ).toString()

  let emailSent = true
  try {
    await sendTeamInviteEmail({
      email: normalizedEmail,
      inviteUrl,
      teamName: team.name,
    })
  } catch (error) {
    emailSent = false
    console.error('Failed to send team invite email', error)
  }

  return {
    invites: await listTeamInvites(team.id),
    inviteUrl,
    emailSent,
  }
}

function requireAdminRole(role: TeamRole) {
  if (!canManageTeamSettings(role)) {
    throw new PublicError('TEAM_MANAGEMENT_FORBIDDEN')
  }
}

function requireMemberManagerRole(role: TeamRole) {
  if (!canManageTeamMembers(role)) {
    throw new PublicError('TEAM_MANAGER_REQUIRED')
  }
}

function requireOwnerRole(role: TeamRole) {
  if (role !== 'owner') {
    throw new PublicError('TEAM_OWNER_REQUIRED')
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeTeamSlug(value: string) {
  const slug = value.trim().toLowerCase()

  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(slug) || slug.length > 100) {
    throw new PublicError('TEAM_SLUG_INVALID')
  }

  return slug
}

async function createInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Buffer.from(bytes).toString('base64url')

  return {
    token,
    tokenHash: await hashToken(token),
  }
}

async function hashToken(token: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )

  return Buffer.from(hash).toString('base64url')
}

export async function assertOtherOwner(
  tx: Pick<typeof db, 'select'>,
  teamId: string,
  userId: string,
) {
  const rows = await tx
    .select({ value: count() })
    .from(teamMembers)
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        ne(teamMembers.userId, userId),
        eq(teamMembers.role, 'owner'),
        eq(user.status, 'active'),
      ),
    )

  if ((rows.at(0)?.value ?? 0) === 0) {
    throw new PublicError('TEAM_LAST_OWNER')
  }
}
