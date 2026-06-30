import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { getAuthSession } from '@/server/auth/session.server'
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

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(100),
})

const avatarSchema = z
  .string()
  .max(3_000_000)
  .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,/)
  .nullable()
  .optional()

const teamGeneralSchema = teamRouteSchema.extend({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
      'Team slugs can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.',
    ),
  avatarDataUrl: avatarSchema,
  deleteAvatar: z.boolean().optional(),
})

const inviteSchema = teamRouteSchema.extend({
  email: z.string().trim().email().max(320),
  role: z.enum(['admin', 'member']),
})

const bulkInviteSchema = teamRouteSchema.extend({
  emails: z.string().trim().min(1).max(20_000),
  role: z.enum(['admin', 'member']),
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
  .validator((data: unknown) => teamGeneralSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return updateTeamGeneral({
      userId: session.user.id,
      ...data,
    })
  })

export const createTeamAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => createTeamSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return createTeam({
      userId: session.user.id,
      name: data.name,
    })
  })

export const createTeamInviteAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => inviteSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return createTeamInvite({
      userId: session.user.id,
      ...data,
    })
  })

export const createTeamInvitesAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const parsed = bulkInviteSchema.parse(data)
    const emails = Array.from(
      new Set(
        parsed.emails
          .split(/[\s,]+/)
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    )
    const emailSchema = z.string().email().max(320)
    const invalidEmail = emails.find(
      (email) => !emailSchema.safeParse(email).success,
    )

    if (invalidEmail) {
      throw new Error(`Invalid email address: ${invalidEmail}.`)
    }

    return {
      teamSlug: parsed.teamSlug,
      emails,
      role: parsed.role,
    }
  })
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return createTeamInvites({
      userId: session.user.id,
      ...data,
    })
  })

export const resendTeamInviteAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => inviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return resendTeamInvite({
      userId: session.user.id,
      ...data,
    })
  })

export const revokeTeamInviteAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => inviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return revokeTeamInvite({
      userId: session.user.id,
      ...data,
    })
  })

export const updateTeamMemberRoleAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => memberRoleSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return updateTeamMemberRole({
      userId: session.user.id,
      ...data,
    })
  })

export const removeTeamMemberAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => memberSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return removeTeamMember({
      userId: session.user.id,
      ...data,
    })
  })

export const transferTeamOwnershipAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => memberSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return transferTeamOwnership({
      userId: session.user.id,
      ...data,
    })
  })

export const deleteTeamAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => deleteTeamSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return acceptTeamInvite({
      userId: session.user.id,
      token: data.token,
    })
  })

export const acceptUserTeamInviteAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => userInviteIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return acceptUserTeamInvite({
      userId: session.user.id,
      inviteId: data.inviteId,
    })
  })
