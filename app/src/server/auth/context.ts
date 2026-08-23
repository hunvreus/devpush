import { createServerFn } from '@tanstack/react-start'

import { getAuthMethods } from '@/lib/auth/config'
import { getAuthSession } from '@/server/auth/session.server'
import { getAgentBinaryStatus } from '@/server/install/agent-binary'
import { listTeamDeployments } from '@/server/projects/service'
import { requireTeamServer } from '@/server/servers/service'
import {
  getUserContext,
  getTeamDeletionStatus,
  listTeamInvites,
  listTeamMembers,
  listTeamProjects,
  listTeamServers,
  requireTeam,
} from '@/server/teams/service'
import {
  backfillAuthAccountIdentities,
  listUserTeams,
} from '@/server/users/service'

export type AuthUserContext = Awaited<ReturnType<typeof getUserContext>>

export const getLoginContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getAuthSession()

    return {
      authMethods: getAuthMethods(),
      userContext: session ? await getUserContext(session.user.id) : null,
    }
  },
)

export const getCurrentUserContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    return getUserContext(session.user.id)
  },
)

export const getUserSettingsContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const [context, accounts, teams] = await Promise.all([
      getUserContext(session.user.id),
      backfillAuthAccountIdentities({ userId: session.user.id }),
      listUserTeams(session.user.id),
    ])

    return {
      ...context,
      accounts,
      authMethods: getAuthMethods(),
      teams,
    }
  },
)

export const getTeamHomeContext = createServerFn({ method: 'GET' })
  .validator((data: { teamSlug: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const [userContext, team] = await Promise.all([
      getUserContext(session.user.id),
      requireTeam(session.user.id, data.teamSlug),
    ])

    const [projects, deployments, servers, serverInstall] = await Promise.all([
      listTeamProjects(team.id),
      listTeamDeployments({ teamId: team.id, limit: 5 }),
      listTeamServers(team.id),
      getAgentBinaryStatus(),
    ])

    return {
      userContext,
      team,
      projects,
      deployments,
      servers,
      serverInstall,
    }
  })

export const getTeamSettingsContext = createServerFn({ method: 'GET' })
  .validator((data: { teamSlug: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const [userContext, team] = await Promise.all([
      getUserContext(session.user.id),
      requireTeam(session.user.id, data.teamSlug),
    ])

    const [members, invites, servers, deletionStatus] = await Promise.all([
      listTeamMembers(team.id),
      listTeamInvites(team.id),
      listTeamServers(team.id),
      getTeamDeletionStatus({ teamId: team.id }),
    ])

    return {
      userContext,
      team,
      members,
      invites,
      servers,
      deletionStatus,
    }
  })

export const getTeamServerContext = createServerFn({ method: 'GET' })
  .validator((data: { serverId: string; teamSlug: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const [userContext, team] = await Promise.all([
      getUserContext(session.user.id),
      requireTeam(session.user.id, data.teamSlug),
    ])

    const [server, servers, serverInstall] = await Promise.all([
      requireTeamServer({
        userId: session.user.id,
        teamSlug: data.teamSlug,
        serverId: data.serverId,
      }),
      listTeamServers(team.id),
      getAgentBinaryStatus(),
    ])

    return {
      userContext,
      team,
      server,
      servers,
      serverInstall,
    }
  })
