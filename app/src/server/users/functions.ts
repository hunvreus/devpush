import { getRequest } from '@tanstack/react-start/server'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { requireAuthSession } from '@/server/auth/session.server'
import {
  accountSettingsSchema,
  accountEmailSchema,
  accountValidationErrors,
  accountServiceErrors,
} from '@/lib/account-settings-schema'
import {
  assertActiveUser,
  disconnectAuthAccount,
  deleteUserAccount,
  leaveTeam,
  updateUserGeneral,
} from '@/server/users/service'

export const updateUserGeneralAction = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof accountSettingsSchema>) => data)
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    const parsed = accountSettingsSchema.safeParse(data)
    if (!parsed.success)
      return { fieldErrors: accountValidationErrors(parsed.error.issues) }
    try {
      await updateUserGeneral({ userId: session.user.id, ...parsed.data })
      return { fieldErrors: null }
    } catch (error) {
      const fieldErrors = accountServiceErrors(error)
      if (fieldErrors) return { fieldErrors }
      throw error
    }
  })

export const requestEmailChangeAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => accountEmailSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

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
    const session = await requireAuthSession()

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
    const session = await requireAuthSession()

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
    const session = await requireAuthSession()

    return deleteUserAccount({
      userId: session.user.id,
      confirmationName: data.confirmationName,
    })
  })
