import type { AgentUpdate } from '#devpush/server/agents/compatibility'
import type { TeamRole } from '#devpush/lib/team-role'
import type { getResourceColor } from '#devpush/server/resources/color'
import type { ServerMonitoringSummary } from '#devpush/server/servers/monitoring'
import type { ServerStatus } from '#devpush/server/servers/status'

export type TeamSummary = {
  settingsVersion: number
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
  publicIpv4?: string | null
  publicIpv6?: string | null
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
    profileConfirmedAt?: number | null
    settingsVersion: number
    id: string
    name: string
    username: string
    email: string
    image: string | null
    defaultTeamId: string | null
    isInstallationAdmin: boolean
  }
  teams: Array<TeamSummary>
  defaultTeam: TeamSummary
  invites: Array<UserTeamInviteSummary>
}
