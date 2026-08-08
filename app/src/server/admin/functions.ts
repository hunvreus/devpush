import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { getAuthSession } from '@/server/auth/session.server'
import {
  addAllowlistRule,
  banUser,
  deleteAdminUser,
  deleteAllowlistRule,
  getAdminOverview,
  importAllowlistEmails,
  unbanUser,
} from '@/server/admin/service'
import { getUserContext } from '@/server/teams/service'

const allowlistRuleSchema = z.object({
  type: z.enum(['email', 'domain', 'pattern']),
  value: z.string().trim().min(1).max(255),
})

const allowlistImportSchema = z.object({
  emails: z.string().trim().min(1).max(20_000),
})

const idSchema = z.object({
  id: z.string().min(1),
})

const userIdSchema = z.object({
  userId: z.string().min(1),
})

export const getAdminSettingsContext = createServerFn({
  method: 'GET',
}).handler(async () => {
  const session = await getAuthSession()

  if (!session) {
    return null
  }

  const [userContext, adminOverview] = await Promise.all([
    getUserContext(session.user.id),
    getAdminOverview(),
  ])

  return {
    userContext,
    adminOverview,
  }
})

export const addAllowlistRuleAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => allowlistRuleSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    await addAllowlistRule(data)
  })

export const importAllowlistEmailsAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => allowlistImportSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    await importAllowlistEmails(data)
  })

export const deleteAllowlistRuleAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    await deleteAllowlistRule(data)
  })

export const banUserAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => userIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    await banUser({ actorUserId: session.user.id, targetUserId: data.userId })
  })

export const unbanUserAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => userIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    await unbanUser({ actorUserId: session.user.id, targetUserId: data.userId })
  })

export const deleteAdminUserAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => userIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Unauthorized')
    }

    await deleteAdminUser({
      actorUserId: session.user.id,
      targetUserId: data.userId,
    })
  })
