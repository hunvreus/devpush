import {
  allowlistRuleSchema,
  allowlistImportSchema,
} from '@/lib/allowlist-schema'
import { formErrors } from '@/lib/form-errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  getAuthSession,
  requireAuthSession,
} from '@/server/auth/session.server'
import { requireInstallationAdmin } from '@/server/admin/access'
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
import { getInstallationInfo } from '@/server/admin/installation'

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
    getAdminOverview(session.user),
  ])

  return {
    userContext,
    adminOverview,
  }
})

export const getInstallationReleaseStatus = createServerFn({
  method: 'GET',
}).handler(async () => {
  const session = await requireAuthSession()

  await requireInstallationAdmin(session.user)
  return (await getInstallationInfo()).latest
})

export const addAllowlistRuleAction = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof allowlistRuleSchema>) => data)
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    await requireInstallationAdmin(session.user)
    const parsed = allowlistRuleSchema.safeParse(data)
    if (!parsed.success) return { fieldErrors: formErrors(parsed.error.issues) }
    await addAllowlistRule({ actorUserId: session.user.id, ...parsed.data })
    return { fieldErrors: null }
  })

export const importAllowlistEmailsAction = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof allowlistImportSchema>) => data)
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    await requireInstallationAdmin(session.user)
    const parsed = allowlistImportSchema.safeParse(data)
    if (!parsed.success) return { fieldErrors: formErrors(parsed.error.issues) }
    await importAllowlistEmails({
      actorUserId: session.user.id,
      ...parsed.data,
    })
    return { fieldErrors: null }
  })

export const deleteAllowlistRuleAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    await requireInstallationAdmin(session.user)

    await deleteAllowlistRule({ actorUserId: session.user.id, ...data })
  })

export const banUserAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => userIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    await requireInstallationAdmin(session.user)

    await banUser({ actorUserId: session.user.id, targetUserId: data.userId })
  })

export const unbanUserAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => userIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    await requireInstallationAdmin(session.user)

    await unbanUser({ actorUserId: session.user.id, targetUserId: data.userId })
  })

export const deleteAdminUserAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) => userIdSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()

    await requireInstallationAdmin(session.user)

    await deleteAdminUser({
      actorUserId: session.user.id,
      targetUserId: data.userId,
    })
  })
