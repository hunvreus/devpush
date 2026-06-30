import { getRequest } from '@tanstack/react-start/server'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { getAuthSession } from '@/server/auth/session.server'
import {
  assertActiveUser,
  disconnectAuthAccount,
  deleteUserAccount,
  leaveTeam,
  updateUserGeneral,
} from '@/server/users/service'

const avatarSchema = z
  .string()
  .max(3_000_000)
  .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,/)
  .nullable()
  .optional()

export const updateUserGeneralAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(256),
        username: z
          .string()
          .trim()
          .min(1)
          .max(50)
          .regex(
            /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
            'Username must start and end with a letter or number and only use letters, numbers, dots, underscores, or hyphens.',
          ),
        avatarDataUrl: avatarSchema,
        deleteAvatar: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return updateUserGeneral({
      userId: session.user.id,
      ...data,
    })
  })

export const requestEmailChangeAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z.object({ newEmail: z.string().trim().email().max(320) }).parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    const request = getRequest()

    await assertActiveUser(session.user.id)

    return auth.api.changeEmail({
      body: {
        newEmail: data.newEmail,
        callbackURL: '/settings#email',
      },
      headers: request.headers,
    })
  })

export const disconnectAuthAccountAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({
        providerId: z.string().min(1),
        accountId: z.string().min(1).optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return disconnectAuthAccount({
      userId: session.user.id,
      ...data,
    })
  })

export const leaveTeamAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z.object({ teamId: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return leaveTeam({
      userId: session.user.id,
      teamId: data.teamId,
    })
  })

export const deleteUserAccountAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z.object({ confirmationName: z.string().trim().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    return deleteUserAccount({
      userId: session.user.id,
      confirmationName: data.confirmationName,
    })
  })
