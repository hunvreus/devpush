import { getErrorMessage } from '@/lib/error-message'
import { bootstrapOwnedTeam, insertOwnedTeam } from './creation'
import { acceptInvitation } from './invitations'
import { mutateTeamMembership, mutateTeamOwnership } from './membership'
import { isUniqueConstraintError } from '@/server/db/errors'
import { and, count, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm'

import { canManageTeamMembers, canManageTeamSettings } from '@/lib/team-role'
import type { TeamRole } from '@/lib/team-role'
import { config } from '@/server/config'
import { db } from '@/server/db'
import { deleteTeamState } from './deletion-state'
import { teamInvites, teamMembers, teams, user } from '@/server/db/schema'
import { sendTeamInviteEmail } from '@/server/email/service'
import { getResourceColor } from '@/server/resources/color'
import { removePublicFile, resolveAvatarUpdate } from '@/server/uploads/avatar'
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
  'new-team',
  'setup',
  'upload',
  'user',
])

export async function ensureUserBootstrap(userId: string) {
  const [currentUser] = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!currentUser || currentUser.status !== 'active')
    throw new Error('User not found')
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
    throw new Error('User not found')
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
    throw new Error('User not found')
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
    throw new Error('User not found')
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

export async function requireTeam(userId: string, teamSlug: string) {
  const teamRows = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      image: teams.avatarPath,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teams.slug, teamSlug),
        eq(teams.status, 'active'),
      ),
    )
    .limit(1)
  const team = teamRows.at(0)

  if (!team) {
    throw new Error('Team not found')
  }

  return {
    ...team,
    color: getResourceColor(team.id),
  }
}

export async function requireTeamManager(userId: string, teamSlug: string) {
  const team = await requireTeam(userId, teamSlug)

  if (!canManageTeamSettings(team.role)) {
    throw new Error('Forbidden')
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
    throw new Error('Team name is required.')
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
    throw new Error('User not found')

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

export async function getTeamDeletionStatus({
  ignoreDefaultForUserId,
  teamId,
}: {
  ignoreDefaultForUserId?: string
  teamId: string
}) {
  const defaultUserRows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.defaultTeamId, teamId), eq(user.status, 'active')))

  return {
    canDelete: canDeleteTeam({
      defaultUserIds: defaultUserRows.map((row) => row.id),
      ignoreDefaultForUserId,
    }),
    defaultUserCount: defaultUserRows.length,
  }
}

export async function updateTeamGeneral({
  userId,
  teamSlug,
  name,
  slug,
  avatarDataUrl,
  deleteAvatar,
}: {
  userId: string
  teamSlug: string
  name: string
  slug: string
  avatarDataUrl?: string | null
  deleteAvatar?: boolean
}) {
  const team = await requireTeam(userId, teamSlug)
  requireAdminRole(team.role)

  const normalizedName = name.trim()
  const normalizedSlug = normalizeTeamSlug(slug)

  if (!normalizedName) {
    throw new Error('Team name is required.')
  }

  if (forbiddenTeamSlugs.has(normalizedSlug)) {
    throw new Error('This slug is reserved.')
  }

  const avatarPath = await resolveAvatarUpdate({
    filePrefix: 'team',
    resourceId: team.id,
    currentAvatarPath: team.image,
    avatarDataUrl,
    deleteAvatar: deleteAvatar ?? false,
  })

  try {
    await db
      .update(teams)
      .set({
        name: normalizedName,
        slug: normalizedSlug,
        avatarPath,
        updatedAt: new Date(),
      })
      .where(eq(teams.id, team.id))
  } catch {
    if (avatarPath && avatarPath !== team.image) {
      await removePublicFile(avatarPath)
    }

    throw new Error('A team with this slug already exists.')
  }

  return requireTeam(userId, normalizedSlug)
}

export async function createTeamInvite({
  userId,
  teamSlug,
  email,
  role,
}: {
  userId: string
  teamSlug: string
  email: string
  role: Exclude<TeamRole, 'owner'>
}) {
  const team = await requireTeam(userId, teamSlug)
  requireAdminRole(team.role)

  return upsertTeamInvite({ userId, team, email, role })
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
    throw new Error('Enter at least one email address.')
  }

  const team = await requireTeam(userId, teamSlug)
  requireAdminRole(team.role)

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
        message: getErrorMessage(
          error,
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
    throw new Error('Invite not found.')
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
    throw new Error('Invite not found.')
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
    throw new Error('Member not found.')
  }

  if (team.role !== 'owner' && (member.role === 'owner' || role === 'owner')) {
    throw new Error('Only team owners can manage owner roles.')
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
    throw new Error('Member not found.')
  }

  if (team.role !== 'owner' && member.role === 'owner') {
    throw new Error('Only team owners can remove owners.')
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
  if (!member) throw new Error('Member not found.')
  if (team.role !== 'owner' && (member.role === 'owner' || role === 'owner')) {
    throw new Error(
      role === null
        ? 'Only team owners can remove owners.'
        : 'Only team owners can manage owner roles.',
    )
  }
  if (member.role === 'owner' && role !== 'owner')
    throw new Error('There must be at least one owner.')
  throw new Error('Team membership changed. Try again.')
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
    throw new Error('Choose another member to transfer ownership to.')
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
    throw new Error('Only team owners can transfer ownership.')
  }

  if (!targetMembership) {
    throw new Error('Member not found.')
  }

  if (targetMembership.role === 'owner') {
    throw new Error('Member is already an owner.')
  }

  if (
    !(await mutateTeamOwnership(db, {
      teamId: team.id,
      actorId: userId,
      memberId: memberUserId,
    }))
  ) {
    throw new Error('Team membership changed. Try again.')
  }

  return listTeamMembers(team.id)
}

export async function deleteTeam({
  ignoreDefaultForUserId,
  userId,
  teamSlug,
  confirmationName,
}: {
  confirmationName?: string
  ignoreDefaultForUserId?: string
  userId: string
  teamSlug: string
}) {
  const team = await requireTeam(userId, teamSlug)
  requireOwnerRole(team.role)

  if (confirmationName !== team.slug) {
    throw new Error('Type the team name to confirm deletion.')
  }

  const defaultUserRows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.defaultTeamId, team.id), eq(user.status, 'active')))
  if (
    !canDeleteTeam({
      defaultUserIds: defaultUserRows.map((row) => row.id),
      ignoreDefaultForUserId,
    })
  )
    throw new Error('You cannot delete a default team.')
  if (
    !(await deleteTeamState(db, {
      teamId: team.id,
      userId,
      ignoreDefaultForUserId,
      now: new Date(),
    }))
  )
    throw new Error('Team changed or became a default team. Try again.')
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
    throw new Error('User not found.')

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
    throw new Error('Invalid or expired invitation.')
  if (normalizeEmail(currentUser.email) !== row.invite.email) {
    throw new Error('Sign in with the invited email address to accept.')
  }
  if (!currentUser.emailVerified) {
    throw new Error('Verify your email address before accepting this invite.')
  }

  if (
    !(await acceptInvitation(db, {
      userId,
      inviteId: row.invite.id,
      tokenHash: row.invite.tokenHash,
      now,
    }))
  )
    throw new Error('Invalid or expired invitation.')
  return row.teamSlug
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
    throw new Error('Email is required.')
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
    throw new Error(`${normalizedEmail} is already a member of this team.`)
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
        throw new Error(`Invitation already sent to ${normalizedEmail}.`)
      }

      inviteId = pendingInvite.id
      shouldUpdateInvite = true
    }
  }

  try {
    if (shouldUpdateInvite) {
      await db
        .update(teamInvites)
        .set({
          role,
          tokenHash,
          expiresAt,
          inviterId: userId,
          updatedAt: now,
        })
        .where(eq(teamInvites.id, inviteId))
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

    throw new Error(`Invitation already sent to ${normalizedEmail}.`)
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
    throw new Error('You do not have permission to manage this team.')
  }
}

function requireMemberManagerRole(role: TeamRole) {
  if (!canManageTeamMembers(role)) {
    throw new Error('Only team owners and admins can manage this team.')
  }
}

function requireOwnerRole(role: TeamRole) {
  if (role !== 'owner') {
    throw new Error('Only team owners can manage this team.')
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeTeamSlug(value: string) {
  const slug = value.trim().toLowerCase()

  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(slug) || slug.length > 100) {
    throw new Error(
      'Team slugs can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.',
    )
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
    throw new Error('There must be at least one owner.')
  }
}
