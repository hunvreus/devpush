import { listBackupStorage } from '@/server/backups/storage'
import { createServerFn } from '@tanstack/react-start'

import { getAuthMethods } from '@/lib/auth/config'
import { getAuthSession } from '@/server/auth/session.server'
import { getAgentBinaryStatus } from '@/server/install/agent-binary'
import { listTeamDeployments } from '@/server/projects/context'
import { requireServerForTeam } from '@/server/servers/service'
import {
  getUserContext,
  getTeamDeletionStatus,
  requireTeam,
} from '@/server/teams/service'
import {
  listTeamInvites,
  listTeamMembers,
  listTeamProjects,
  listTeamServers,
} from '@/server/teams/queries'
import { listAuthAccounts, listUserTeams } from '@/server/users/service'

export type AuthUserContext = Awaited<ReturnType<typeof getUserContext>>
export type TeamContextSection = 'overview' | 'servers' | 'settings'

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
      listAuthAccounts(session.user.id, { validateUser: false }),
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

export const getTeamShellContext = createServerFn({ method: 'GET' })
  .validator((data: { teamSlug: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const userContext = await getUserContext(session.user.id)
    const team = userContext.teams.find((item) => item.slug === data.teamSlug)

    if (!team) {
      throw new Error('Team not found')
    }

    const [projects, servers] = await Promise.all([
      listTeamProjects(team.id),
      listTeamServers(team.id, { includeMonitoring: false }),
    ])

    return {
      userContext,
      team,
      projects,
      servers,
    }
  })

export const getTeamSectionContext = createServerFn({ method: 'GET' })
  .validator((data: { section: TeamContextSection; teamSlug: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const team = await requireTeam(session.user.id, data.teamSlug)

    if (data.section === 'overview') {
      return {
        section: data.section,
        deployments: await listTeamDeployments({ teamId: team.id, limit: 5 }),
      } as const
    }

    if (data.section === 'servers') {
      const [servers, serverInstall] = await Promise.all([
        listTeamServers(team.id, { includeMonitoring: true }),
        getAgentBinaryStatus(),
      ])

      return { section: data.section, servers, serverInstall } as const
    }

    const [members, invites, deletionStatus, backupStorage] = await Promise.all(
      [
        listTeamMembers(team.id),
        listTeamInvites(team.id),
        getTeamDeletionStatus({ teamId: team.id }),
        listBackupStorage(team.id, team.role !== 'member'),
      ],
    )

    return {
      section: data.section,
      settings: { deletionStatus, invites, members, backupStorage },
    } as const
  })

export const getTeamServerContext = createServerFn({ method: 'GET' })
  .validator((data: { serverId: string; teamSlug: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const team = await requireTeam(session.user.id, data.teamSlug)
    const server = await requireServerForTeam({
      teamId: team.id,
      serverId: data.serverId,
    })

    return {
      team,
      server,
    }
  })
