import { getAuthMethods } from '@/server/auth/auth-methods'
import { getAuthSession, requireAuthSession  } from '@/server/auth/session.server'
import { getUserContext } from '@/server/teams/service'
import { listAuthAccounts, listUserTeams,
  assertActiveUser,
  disconnectAuthAccount,
  deleteUserAccount,
  leaveTeam,
  updateUserGeneral } from '@/server/users/service'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { user } from '@/server/db/schema'
import { PublicError } from '@/lib/public-error'
import { assertAllowedEmailChange } from '@/server/auth/email-change'
import { publicErrorsMiddleware } from '@/server/http/public-errors'
import { getRequest } from '@tanstack/react-start/server'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { auth } from '@/server/auth/better-auth'
import {
  accountSettingsSchema,
  accountEmailSchema,
  accountValidationErrors,
  accountServiceErrors,
} from '@/lib/account-settings-schema'

export const updateUserGeneralAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: z.input<typeof accountSettingsSchema>) => data)
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    const parsed = accountSettingsSchema.safeParse(data)
    if (!parsed.success)
      return { fieldErrors: accountValidationErrors(parsed.error.issues) }
    try {
      const profile = await updateUserGeneral({
        userId: session.user.id,
        ...parsed.data,
      })
      return { user: profile, fieldErrors: null }
    } catch (error) {
      const fieldErrors = accountServiceErrors(error)
      if (fieldErrors) return { fieldErrors }
      throw error
    }
  })

export const requestEmailChangeAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => accountEmailSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    if (data.newEmail === session.user.email.toLowerCase())
      throw new PublicError('ACCOUNT_EMAIL_UNCHANGED')

    const request = getRequest()

    await assertActiveUser(session.user.id)
    await assertAllowedEmailChange(data.newEmail)

    const changed = await db
      .update(user)
      .set({ settingsVersion: sql`${user.settingsVersion} + 1` })
      .where(
        and(
          eq(user.id, session.user.id),
          eq(user.status, 'active'),
          eq(user.settingsVersion, data.settingsVersion),
          eq(user.email, session.user.email),
        ),
      )
      .returning({ settingsVersion: user.settingsVersion })
    if (!changed.length) throw new PublicError('SETTINGS_CONFLICT')
    await auth.api.changeEmail({
      body: {
        newEmail: data.newEmail,
        callbackURL: '/settings#email',
      },
      headers: request.headers,
    })
    return changed[0]!
  })

export const disconnectAuthAccountAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
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
  .middleware([publicErrorsMiddleware])
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
  .middleware([publicErrorsMiddleware])
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

export const getUserSettingsContext = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .handler(async () => {
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
  })
