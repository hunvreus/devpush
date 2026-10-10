import {
  createTeamSchema,
  inviteSchema,
  bulkInviteSchema,
  parseInviteEmails,
} from '@/lib/team-forms-schema'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireAuthSession } from '@/server/auth/session.server'
import {
  teamGeneralSchema,
  teamSettingsErrors,
} from '@/lib/team-settings-schema'
import { formErrors } from '@/lib/form-errors'
import {
  acceptTeamInvite,
  acceptUserTeamInvite,
  createTeam,
  createTeamInvite,
  createTeamInvites,
  deleteTeam,
  removeTeamMember,
  resendTeamInvite,
  revokeTeamInvite,
  transferTeamOwnership,
  updateTeamGeneral,
  updateTeamMemberRole,
} from '@/server/teams/service'

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
  .validator((data: unknown) => createTeamSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return createTeam({
      userId: session.user.id,
      name: data.name,
    })
  })

export const createTeamInviteAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => inviteSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return createTeamInvite({
      userId: session.user.id,
      ...data,
    })
  })

export const createTeamInvitesAction = createServerFn({ method: 'POST' })
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
  .validator((data: unknown) => inviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return resendTeamInvite({
      userId: session.user.id,
      ...data,
    })
  })

export const revokeTeamInviteAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => inviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return revokeTeamInvite({
      userId: session.user.id,
      ...data,
    })
  })

export const updateTeamMemberRoleAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => memberRoleSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return updateTeamMemberRole({
      userId: session.user.id,
      ...data,
    })
  })

export const removeTeamMemberAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => memberSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return removeTeamMember({
      userId: session.user.id,
      ...data,
    })
  })

export const transferTeamOwnershipAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => memberSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return transferTeamOwnership({
      userId: session.user.id,
      ...data,
    })
  })

export const deleteTeamAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => deleteTeamSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return deleteTeam({
      userId: session.user.id,
      ...data,
    })
  })

export const acceptTeamInviteAction = createServerFn({ method: 'POST' })
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
  .validator((data: unknown) => userInviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    return acceptUserTeamInvite({
      userId: session.user.id,
      inviteId: data.inviteId,
    })
  })
