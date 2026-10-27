import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuthSession } from '#devpush/server/auth/session.server'
import { publicErrorsMiddleware } from '#devpush/server/http/public-errors'
import {
  notificationPreferencesSchema,
  notificationScopeSchema,
} from '#devpush/lib/notification-preferences'
import {
  readNotificationPreferences,
  saveNotificationPreferences,
  readNotificationMute,
  saveNotificationMute,
} from './preferences'

export const getNotificationPreferences = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .handler(async () => {
    const session = await requireAuthSession()
    return readNotificationPreferences(session.user.id)
  })
export const updateNotificationPreferences = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    z.object({
      preferences: notificationPreferencesSchema,
      version: z.number().int().nonnegative(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    return saveNotificationPreferences(
      session.user.id,
      data.preferences,
      data.version,
    )
  })
export const getNotificationMute = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator(notificationScopeSchema)
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    return readNotificationMute(session.user.id, data)
  })
export const updateNotificationMute = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(z.object({ scope: notificationScopeSchema, muted: z.boolean() }))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    return saveNotificationMute(session.user.id, data.scope, data.muted)
  })
