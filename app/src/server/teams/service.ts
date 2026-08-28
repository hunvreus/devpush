import { and, count, desc, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm'

import { canManageTeamMembers, canManageTeamSettings } from '@/lib/team-role'
import type { TeamRole } from '@/lib/team-role'
import { config, currentAgentVersion } from '@/server/config'
import { db } from '@/server/db'
import { enqueueTeamDeprovisionJobs } from '@/server/agents/cleanup'
import {
  agentJobs,
  aliases,
  backupRuns,
  domains,
  deployments,
  environments,
  projects,
  servers,
  teamInvites,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import { sendTeamInviteEmail } from '@/server/email/service'
import { getResourceColor } from '@/server/resources/color'
import { getEffectiveServerStatus } from '@/server/servers/status'
import type { ServerStatus } from '@/server/servers/status'
import { getAgentUpdate } from '@/server/agents/compatibility'
import type { AgentUpdate } from '@/server/agents/compatibility'
import { listServerMonitoringSummaries } from '@/server/servers/monitoring'
import type { ServerMonitoringSummary } from '@/server/servers/monitoring'
import { removePublicFile, resolveAvatarUpdate } from '@/server/uploads/avatar'
import { canDeleteTeam } from './delete-policy'

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type TeamSummary = {
  id: string
  slug: string
  name: string
  image: string | null
  color: ReturnType<typeof getResourceColor>
  role: TeamRole
}

export type ProjectSummary = {
  id: string
  name: string
  avatarUrl: string | null
  githubRepo: string
  defaultHost: string | null
  defaultRouteHttps: boolean
  color: ReturnType<typeof getResourceColor>
}

export type ServerSummary = {
  id: string
  name: string
  publicAddress: string | null
  status: ServerStatus
  agentVersion: string | null
  agentUpdate: AgentUpdate
  lastSeenAt: string | null
  monitoring: ServerMonitoringSummary
}

export type TeamMemberSummary = {
  id: string
  role: TeamRole
  user: {
    id: string
    name: string
    username: string
    email: string
    image: string | null
  }
}

export type TeamInviteSummary = {
  id: string
  email: string
  role: Exclude<TeamRole, 'owner'>
  expiresAt: string
  createdAt: string
  inviter: {
    id: string
    name: string
    email: string
    image: string | null
  } | null
}

export type UserTeamInviteSummary = {
  id: string
  role: Exclude<TeamRole, 'owner'>
  expiresAt: string
  createdAt: string
  team: {
    id: string
    slug: string
    name: string
    image: string | null
    color: ReturnType<typeof getResourceColor>
  }
  inviter: {
    id: string
    name: string
    email: string
    image: string | null
  } | null
}

export type UserContext = {
  user: {
    id: string
    name: string
    username: string
    email: string
    image: string | null
    defaultTeamId: string | null
  }
  teams: Array<TeamSummary>
  defaultTeam: TeamSummary
  invites: Array<UserTeamInviteSummary>
}

export async function ensureUserBootstrap(userId: string) {
  return db.transaction(async (tx) => {
    const currentUserRows = await tx
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const currentUser = currentUserRows.at(0)

    if (!currentUser || currentUser.status !== 'active') {
      throw new Error('User not found')
    }

    if (currentUser.defaultTeamId) {
      const existingMembershipRows = await tx
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .where(
          and(
            eq(teamMembers.userId, userId),
            eq(teamMembers.teamId, currentUser.defaultTeamId),
            eq(teams.status, 'active'),
          ),
        )
        .limit(1)
      const existingMembership = existingMembershipRows.at(0)

      if (existingMembership) {
        return currentUser.defaultTeamId
      }
    }

    const firstMembershipRows = await tx
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teamMembers.userId, userId), eq(teams.status, 'active')))
      .orderBy(desc(teamMembers.createdAt))
      .limit(1)
    const firstMembership = firstMembershipRows.at(0)

    if (firstMembership) {
      await tx
        .update(user)
        .set({ defaultTeamId: firstMembership.teamId, updatedAt: new Date() })
        .where(eq(user.id, userId))

      return firstMembership.teamId
    }

    const teamId = crypto.randomUUID()
    const teamName = currentUser.name || currentUser.email.split('@')[0]
    const slug = await getAvailableTeamSlug(tx, teamName, teamId)

    await tx.insert(teams).values({
      id: teamId,
      name: teamName,
      slug,
    })

    await tx.insert(teamMembers).values({
      id: crypto.randomUUID(),
      teamId,
      userId,
      role: 'owner',
    })

    await tx
      .update(user)
      .set({ defaultTeamId: teamId, updatedAt: new Date() })
      .where(eq(user.id, userId))

    return teamId
  })
}

export async function getUserContext(userId: string): Promise<UserContext> {
  await ensureUserBootstrap(userId)

  const currentUserRows = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const currentUser = currentUserRows.at(0)

  if (!currentUser || currentUser.status !== 'active') {
    throw new Error('User not found')
  }

  const memberships = await db
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

  return {
    user: {
      id: currentUser.id,
      name: currentUser.name,
      username: currentUser.username,
      email: currentUser.email,
      image: currentUser.image,
      defaultTeamId: currentUser.defaultTeamId,
    },
    teams: mappedTeams,
    defaultTeam,
    invites: await listUserPendingTeamInvites(userId),
  }
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

  await db.transaction(async (tx) => {
    const slug = await getAvailableTeamSlug(tx, normalizedName, teamId)

    await tx.insert(teams).values({
      id: teamId,
      name: normalizedName,
      slug,
    })

    await tx.insert(teamMembers).values({
      id: crypto.randomUUID(),
      teamId,
      userId,
      role: 'owner',
    })
  })

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

export async function listTeamProjects(
  teamId: string,
): Promise<Array<ProjectSummary>> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      avatarUrl: projects.avatarPath,
      githubRepo: projects.githubRepo,
      defaultHost: aliases.hostname,
      defaultRouteHttps: aliases.https,
    })
    .from(projects)
    .leftJoin(
      environments,
      and(
        eq(environments.projectId, projects.id),
        eq(environments.isProduction, true),
      ),
    )
    .leftJoin(
      aliases,
      and(
        eq(aliases.environmentId, environments.id),
        eq(aliases.type, 'environment'),
      ),
    )
    .where(and(eq(projects.teamId, teamId), eq(projects.status, 'active')))
    .orderBy(desc(projects.updatedAt))

  return rows.map((project) => ({
    id: project.id,
    name: project.name,
    avatarUrl: project.avatarUrl,
    githubRepo: project.githubRepo,
    defaultHost: project.defaultHost,
    defaultRouteHttps: project.defaultRouteHttps ?? false,
    color: getResourceColor(project.id),
  }))
}

export async function listTeamServers(
  teamId: string,
): Promise<Array<ServerSummary>> {
  const now = new Date()
  const rows = await db
    .select({
      id: servers.id,
      name: servers.name,
      publicAddress: servers.publicAddress,
      status: servers.status,
      agentVersion: servers.agentVersion,
      agentProtocolVersion: servers.agentProtocolVersion,
      agentCapabilities: servers.agentCapabilities,
      lastSeenAt: servers.lastSeenAt,
      createdAt: servers.createdAt,
    })
    .from(servers)
    .where(and(eq(servers.teamId, teamId), ne(servers.status, 'deleted')))
    .orderBy(desc(servers.updatedAt))

  const monitoring = await listServerMonitoringSummaries(rows, now)

  return rows.map((server) => ({
    id: server.id,
    name: server.name,
    publicAddress: server.publicAddress,
    status: getEffectiveServerStatus({
      status: server.status,
      lastSeenAt: server.lastSeenAt,
      now,
    }),
    agentVersion: server.agentVersion,
    agentUpdate: server.lastSeenAt
      ? getAgentUpdate({
          agentVersion: server.agentVersion,
          protocolVersion: server.agentProtocolVersion,
          capabilities: server.agentCapabilities,
          latestVersion: currentAgentVersion,
          recommendedVersion: config.DEVPUSH_RECOMMENDED_AGENT_VERSION ?? null,
        })
      : { status: 'current', latestVersion: null, reason: null },
    lastSeenAt: server.lastSeenAt?.toISOString() ?? null,
    monitoring: monitoring.get(server.id) ?? {
      availabilityPercent: null,
      availabilityWindowMs: 0,
      latestMetrics: null,
    },
  }))
}

export async function listTeamMembers(
  teamId: string,
): Promise<Array<TeamMemberSummary>> {
  const rows = await db
    .select({
      id: teamMembers.id,
      role: teamMembers.role,
      userId: user.id,
      userName: user.name,
      userUsername: user.username,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(teamMembers)
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(user.status, 'active')))
    .orderBy(desc(teamMembers.createdAt))

  return rows.map((member) => ({
    id: member.id,
    role: member.role,
    user: {
      id: member.userId,
      name: member.userName,
      username: member.userUsername,
      email: member.userEmail,
      image: member.userImage,
    },
  }))
}

export async function listTeamInvites(
  teamId: string,
): Promise<Array<TeamInviteSummary>> {
  const rows = await db
    .select({
      id: teamInvites.id,
      email: teamInvites.email,
      role: teamInvites.role,
      expiresAt: teamInvites.expiresAt,
      createdAt: teamInvites.createdAt,
      inviterId: user.id,
      inviterName: user.name,
      inviterEmail: user.email,
      inviterImage: user.image,
    })
    .from(teamInvites)
    .leftJoin(user, eq(user.id, teamInvites.inviterId))
    .where(
      and(
        eq(teamInvites.teamId, teamId),
        eq(teamInvites.status, 'pending'),
        gt(teamInvites.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(teamInvites.createdAt))

  return rows.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role === 'admin' ? 'admin' : 'member',
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
    inviter: invite.inviterId
      ? {
          id: invite.inviterId,
          name: invite.inviterName ?? '',
          email: invite.inviterEmail ?? '',
          image: invite.inviterImage,
        }
      : null,
  }))
}

export async function listUserPendingTeamInvites(
  userId: string,
): Promise<Array<UserTeamInviteSummary>> {
  const userRows = await db
    .select({ email: user.email, status: user.status })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const currentUser = userRows.at(0)

  if (!currentUser || currentUser.status !== 'active') {
    throw new Error('User not found.')
  }

  const normalizedEmail = normalizeEmail(currentUser.email)
  const rows = await db
    .select({
      id: teamInvites.id,
      role: teamInvites.role,
      expiresAt: teamInvites.expiresAt,
      createdAt: teamInvites.createdAt,
      teamId: teams.id,
      teamSlug: teams.slug,
      teamName: teams.name,
      teamImage: teams.avatarPath,
      inviterId: user.id,
      inviterName: user.name,
      inviterEmail: user.email,
      inviterImage: user.image,
    })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .leftJoin(user, eq(user.id, teamInvites.inviterId))
    .where(
      and(
        eq(teamInvites.status, 'pending'),
        gt(teamInvites.expiresAt, new Date()),
        eq(teams.status, 'active'),
        sql`lower(${teamInvites.email}) = ${normalizedEmail}`,
      ),
    )
    .orderBy(desc(teamInvites.createdAt))

  return rows.map((invite) => ({
    id: invite.id,
    role: invite.role === 'admin' ? 'admin' : 'member',
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
    team: {
      id: invite.teamId,
      slug: invite.teamSlug,
      name: invite.teamName,
      image: invite.teamImage,
      color: getResourceColor(invite.teamId),
    },
    inviter: invite.inviterId
      ? {
          id: invite.inviterId,
          name: invite.inviterName ?? '',
          email: invite.inviterEmail ?? '',
          image: invite.inviterImage,
        }
      : null,
  }))
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

  let emailSentCount = 0
  let inviteUrl: string | null = null
  let invites: Array<TeamInviteSummary> = []

  for (const email of emails) {
    const result = await upsertTeamInvite({ userId, team, email, role })
    if (result.emailSent) {
      emailSentCount += 1
    }
    inviteUrl = result.inviteUrl
    invites = result.invites
  }

  return {
    emailCount: emails.length,
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

  await db.transaction(async (tx) => {
    await lockTeamMembers(tx, team.id)
    const memberRows = await tx
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

    if (
      team.role !== 'owner' &&
      (member.role === 'owner' || role === 'owner')
    ) {
      throw new Error('Only team owners can manage owner roles.')
    }

    if (member.role === 'owner' && role !== 'owner') {
      await assertOtherOwner(tx, team.id, memberUserId)
    }

    await tx
      .update(teamMembers)
      .set({ role })
      .where(eq(teamMembers.id, member.id))
  })

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

  await db.transaction(async (tx) => {
    await lockTeamMembers(tx, team.id)
    const memberRows = await tx
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

    if (member.role === 'owner') {
      await assertOtherOwner(tx, team.id, memberUserId)
    }

    await tx.delete(teamMembers).where(eq(teamMembers.id, member.id))
  })

  return listTeamMembers(team.id)
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

  await db.transaction(async (tx) => {
    await lockTeamMembers(tx, team.id)

    const memberRows = await tx
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

    await tx
      .update(teamMembers)
      .set({ role: 'owner' })
      .where(eq(teamMembers.id, targetMembership.id))
    await tx
      .update(teamMembers)
      .set({ role: 'admin' })
      .where(eq(teamMembers.id, currentMembership.id))
  })

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

  await db.transaction(async (tx) => {
    const now = new Date()
    const defaultUserRows = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.defaultTeamId, team.id), eq(user.status, 'active')))

    if (
      !canDeleteTeam({
        defaultUserIds: defaultUserRows.map((row) => row.id),
        ignoreDefaultForUserId,
      })
    ) {
      throw new Error('You cannot delete a default team.')
    }

    const serverRows = await tx
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.teamId, team.id))
    const serverIds = serverRows.map((server) => server.id)

    if (serverIds.length > 0) {
      await tx
        .update(agentJobs)
        .set({
          status: 'canceled',
          errorMessage: 'Canceled because the team was deleted.',
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            inArray(agentJobs.serverId, serverIds),
            inArray(agentJobs.type, [
              'deploy',
              'backup',
              'restore',
              'backup_cleanup',
            ]),
            inArray(agentJobs.status, ['queued', 'running']),
          ),
        )
      await tx
        .update(backupRuns)
        .set({
          status: 'canceled',
          errorMessage: 'Canceled because the team was deleted.',
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            inArray(backupRuns.serverId, serverIds),
            inArray(backupRuns.status, ['queued', 'running']),
          ),
        )
    }

    await enqueueTeamDeprovisionJobs(tx, {
      teamId: team.id,
      reason: 'Team deleted.',
    })

    const projectRows = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.teamId, team.id))
    const projectIds = projectRows.map((project) => project.id)

    if (projectIds.length > 0) {
      const environmentRows = await tx
        .select({ id: environments.id })
        .from(environments)
        .where(inArray(environments.projectId, projectIds))
      const environmentIds = environmentRows.map(
        (environment) => environment.id,
      )

      if (environmentIds.length > 0) {
        await tx
          .update(environments)
          .set({ status: 'deleted', isProduction: false, updatedAt: now })
          .where(inArray(environments.id, environmentIds))

        await tx
          .update(deployments)
          .set({
            status: 'canceled',
            phase: 'canceled',
            errorMessage: 'Canceled because the team was deleted.',
            finishedAt: now,
          })
          .where(
            and(
              inArray(deployments.environmentId, environmentIds),
              inArray(deployments.status, ['queued', 'running']),
            ),
          )
      }

      await tx.delete(aliases).where(inArray(aliases.projectId, projectIds))
      await tx.delete(domains).where(inArray(domains.projectId, projectIds))
    }

    await tx
      .update(projects)
      .set({ status: 'deleted', updatedAt: now })
      .where(eq(projects.teamId, team.id))
    await tx
      .update(servers)
      .set({ status: 'deleted', updatedAt: now })
      .where(eq(servers.teamId, team.id))
    await tx
      .update(teams)
      .set({ status: 'deleted', updatedAt: now })
      .where(eq(teams.id, team.id))
  })
}

export async function acceptTeamInvite({
  userId,
  token,
}: {
  userId: string
  token: string
}) {
  const tokenHash = await hashToken(token)
  const now = new Date()

  return db.transaction(async (tx) => {
    const userRows = await tx
      .select({
        email: user.email,
        emailVerified: user.emailVerified,
        status: user.status,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const currentUser = userRows.at(0)

    if (!currentUser || currentUser.status !== 'active') {
      throw new Error('User not found.')
    }

    await tx.execute(
      sql`select id from ${teamInvites} where token_hash = ${tokenHash} for update`,
    )

    const inviteRows = await tx
      .select({
        invite: teamInvites,
        teamSlug: teams.slug,
      })
      .from(teamInvites)
      .innerJoin(teams, eq(teams.id, teamInvites.teamId))
      .where(
        and(
          eq(teamInvites.tokenHash, tokenHash),
          eq(teamInvites.status, 'pending'),
        ),
      )
      .limit(1)
    const row = inviteRows.at(0)

    if (!row || row.invite.expiresAt <= now) {
      throw new Error('Invalid or expired invitation.')
    }

    if (normalizeEmail(currentUser.email) !== row.invite.email) {
      throw new Error('Sign in with the invited email address to accept.')
    }

    if (!currentUser.emailVerified) {
      throw new Error('Verify your email address before accepting this invite.')
    }

    const existingRows = await tx
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, row.invite.teamId),
          eq(teamMembers.userId, userId),
        ),
      )
      .limit(1)

    if (existingRows.length === 0) {
      await tx.insert(teamMembers).values({
        id: crypto.randomUUID(),
        teamId: row.invite.teamId,
        userId,
        role: row.invite.role,
      })
    }

    await tx
      .update(teamInvites)
      .set({ status: 'accepted', updatedAt: now })
      .where(eq(teamInvites.id, row.invite.id))

    return row.teamSlug
  })
}

export async function acceptUserTeamInvite({
  userId,
  inviteId,
}: {
  userId: string
  inviteId: string
}) {
  const now = new Date()

  return db.transaction(async (tx) => {
    const userRows = await tx
      .select({
        email: user.email,
        emailVerified: user.emailVerified,
        status: user.status,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const currentUser = userRows.at(0)

    if (!currentUser || currentUser.status !== 'active') {
      throw new Error('User not found.')
    }

    await tx.execute(
      sql`select id from ${teamInvites} where id = ${inviteId} for update`,
    )

    const inviteRows = await tx
      .select({
        invite: teamInvites,
        teamSlug: teams.slug,
      })
      .from(teamInvites)
      .innerJoin(teams, eq(teams.id, teamInvites.teamId))
      .where(
        and(
          eq(teamInvites.id, inviteId),
          eq(teamInvites.status, 'pending'),
          eq(teams.status, 'active'),
        ),
      )
      .limit(1)
    const row = inviteRows.at(0)

    if (!row || row.invite.expiresAt <= now) {
      throw new Error('Invalid or expired invitation.')
    }

    if (normalizeEmail(currentUser.email) !== row.invite.email) {
      throw new Error('Sign in with the invited email address to accept.')
    }

    if (!currentUser.emailVerified) {
      throw new Error('Verify your email address before accepting this invite.')
    }

    const existingRows = await tx
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, row.invite.teamId),
          eq(teamMembers.userId, userId),
        ),
      )
      .limit(1)

    if (existingRows.length === 0) {
      await tx.insert(teamMembers).values({
        id: crypto.randomUUID(),
        teamId: row.invite.teamId,
        userId,
        role: row.invite.role,
      })
    }

    await tx
      .update(teamInvites)
      .set({ status: 'accepted', updatedAt: now })
      .where(eq(teamInvites.id, row.invite.id))

    return row.teamSlug
  })
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

async function getAvailableTeamSlug(tx: Tx, name: string, id: string) {
  const baseSlug = slugify(name)
  const existingRows = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.slug, baseSlug))
    .limit(1)

  if (existingRows.length === 0) {
    return baseSlug
  }

  return `${baseSlug.slice(0, 32)}-${id.slice(0, 7)}`
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
    config.BETTER_AUTH_URL,
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

function isUniqueConstraintError(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  if ('code' in error && error.code === '23505') {
    return true
  }

  if ('cause' in error) {
    return isUniqueConstraintError(error.cause)
  }

  return false
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

export async function lockTeamMembers(tx: Tx, teamId: string) {
  await tx.execute(
    sql`select id from ${teamMembers} where team_id = ${teamId} for update`,
  )
}

export async function assertOtherOwner(tx: Tx, teamId: string, userId: string) {
  const rows = await tx
    .select({ value: count() })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        ne(teamMembers.userId, userId),
        eq(teamMembers.role, 'owner'),
      ),
    )

  if ((rows.at(0)?.value ?? 0) === 0) {
    throw new Error('There must be at least one owner.')
  }
}
