import { listBackupStorage } from '#devpush/server/backups/storage'
import {
  getAuthSession,
  requireAuthSession,
} from '#devpush/server/auth/session.server'
import { getAgentBinaryStatus } from '#devpush/server/install/agent-binary'
import { listTeamDeployments } from '#devpush/server/projects/context'
import {
  getUserContext,
  getTeamDeletionStatus,
  requireTeam,
  acceptTeamInvite,
  acceptUserTeamInvite,
  declineUserTeamInvite,
  declineTeamInvite,
  createTeam,
  createTeamInvites,
  deleteTeam,
  removeTeamMember,
  resendTeamInvite,
  revokeTeamInvite,
  transferTeamOwnership,
  updateTeamGeneral,
  updateTeamMemberRole,
} from '#devpush/server/teams/service'
import {
  listTeamInvites,
  listTeamMembers,
  listTeamProjects,
  listTeamServers,
} from '#devpush/server/teams/queries'
import { teamContextSectionSchema } from '#devpush/lib/team-context-schema'
import { PublicError } from '#devpush/lib/public-error'
import { publicErrorsMiddleware } from '#devpush/server/http/public-errors'
import {
  createTeamSchema,
  bulkInviteSchema,
  parseInviteEmails,
} from '#devpush/lib/team-forms-schema'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  teamGeneralSchema,
  teamSettingsErrors,
} from '#devpush/lib/team-settings-schema'
import { formErrors } from '#devpush/lib/form-errors'

const teamRouteSchema = z.object({
  teamSlug: z.string().min(1),
})

const deleteTeamSchema = teamRouteSchema.extend({
  confirmationName: z.string().trim().min(1),
})

const inviteIdSchema = teamRouteSchema.extend({
  inviteId: z.string().min(1),
})

const userInviteIdSchema = z.object({
  inviteId: z.string().min(1),
})

const memberRoleSchema = teamRouteSchema.extend({
  memberUserId: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member']),
})

const memberSchema = teamRouteSchema.extend({
  memberUserId: z.string().min(1),
})

export const updateTeamGeneralAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: z.input<typeof teamGeneralSchema>) => data)
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    const parsed = teamGeneralSchema.safeParse(data)
    if (!parsed.success)
      return { fieldErrors: formErrors(parsed.error.issues), team: null }
    try {
      const team = await updateTeamGeneral({
        userId: session.user.id,
        ...parsed.data,
      })
      return { fieldErrors: null, team }
    } catch (error) {
      const fieldErrors = teamSettingsErrors(error)
      if (fieldErrors) return { fieldErrors, team: null }
      throw error
    }
  })

export const createTeamAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => createTeamSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return createTeam({
      userId: session.user.id,
      name: data.name,
    })
  })

export const createTeamInvitesAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => {
    const parsed = bulkInviteSchema.parse(data)
    return {
      teamSlug: parsed.teamSlug,
      emails: parseInviteEmails(parsed.emails),
      role: parsed.role,
    }
  })
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return createTeamInvites({
      userId: session.user.id,
      ...data,
    })
  })

export const resendTeamInviteAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => inviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return resendTeamInvite({
      userId: session.user.id,
      ...data,
    })
  })

export const revokeTeamInviteAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => inviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return revokeTeamInvite({
      userId: session.user.id,
      ...data,
    })
  })

export const updateTeamMemberRoleAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => memberRoleSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return updateTeamMemberRole({
      userId: session.user.id,
      ...data,
    })
  })

export const removeTeamMemberAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => memberSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return removeTeamMember({
      userId: session.user.id,
      ...data,
    })
  })

export const transferTeamOwnershipAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => memberSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return transferTeamOwnership({
      userId: session.user.id,
      ...data,
    })
  })

export const deleteTeamAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => deleteTeamSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return deleteTeam({
      userId: session.user.id,
      ...data,
    })
  })

export const acceptTeamInviteAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) =>
    z.object({ token: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return acceptTeamInvite({
      userId: session.user.id,
      token: data.token,
    })
  })

export const acceptUserTeamInviteAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => userInviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return acceptUserTeamInvite({
      userId: session.user.id,
      inviteId: data.inviteId,
    })
  })

export const declineUserTeamInviteAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => userInviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    return declineUserTeamInvite({
      userId: session.user.id,
      inviteId: data.inviteId,
    })
  })

export const declineTeamInviteAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) =>
    z.object({ token: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    return declineTeamInvite({ userId: session.user.id, token: data.token })
  })

const teamSectionRequestSchema = teamRouteSchema.extend({
  section: teamContextSectionSchema,
})

export const getTeamShellContext = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: z.input<typeof teamRouteSchema>) =>
    teamRouteSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const userContext = await getUserContext(session.user.id)
    const team = userContext.teams.find((item) => item.slug === data.teamSlug)

    if (!team) {
      throw new PublicError('TEAM_NOT_FOUND')
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
  .middleware([publicErrorsMiddleware])
  .validator((data: z.input<typeof teamSectionRequestSchema>) =>
    teamSectionRequestSchema.parse(data),
  )
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
