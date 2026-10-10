import { and, desc, eq, gt, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import { getAgentUpdate } from '@/server/agents/compatibility'
import { config, currentAgentVersion } from '@/server/config'
import { db } from '@/server/db'
import {
  aliases,
  environments,
  projects,
  servers,
  teamInvites,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import { getResourceColor } from '@/server/resources/color'
import { listServerMonitoringSummaries } from '@/server/servers/monitoring'
import type { ServerMonitoringSummary } from '@/server/servers/monitoring'
import { getEffectiveServerStatus } from '@/server/servers/status'
import type {
  ProjectSummary,
  ServerSummary,
  TeamInviteSummary,
  TeamMemberSummary,
  UserTeamInviteSummary,
} from './types'

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
  { includeMonitoring = true }: { includeMonitoring?: boolean } = {},
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

  const monitoring = includeMonitoring
    ? await listServerMonitoringSummaries(rows, now)
    : new Map<string, ServerMonitoringSummary>()

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
  const invitee = alias(user, 'invitee')
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
    .innerJoin(
      invitee,
      and(
        eq(invitee.id, userId),
        eq(invitee.status, 'active'),
        sql`lower(${teamInvites.email}) = lower(${invitee.email})`,
      ),
    )
    .leftJoin(user, eq(user.id, teamInvites.inviterId))
    .where(
      and(
        eq(teamInvites.status, 'pending'),
        gt(teamInvites.expiresAt, new Date()),
        eq(teams.status, 'active'),
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
