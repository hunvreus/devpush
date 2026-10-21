import { settingsVersionSchema } from '@/lib/settings-version'
import { publicErrorsMiddleware } from '@/server/http/public-errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { backupStorageSchema } from '@/lib/backup-storage-schema'
import { requireAuthSession } from '@/server/auth/session.server'
import { saveBackupStorage, deleteBackupStorage } from './storage'
import { requireBackupsEnabled } from './feature'

export const saveBackupStorageAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        teamSlug: z.string().min(1),
        settingsVersion: settingsVersionSchema.nullable(),
        input: backupStorageSchema,
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    requireBackupsEnabled()
    const session = await requireAuthSession()
    return saveBackupStorage({ userId: session.user.id, ...data })
  })

export const deleteBackupStorageAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        teamSlug: z.string().min(1),
        settingsVersion: settingsVersionSchema,
        storageId: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    requireBackupsEnabled()
    const session = await requireAuthSession()
    return deleteBackupStorage({ userId: session.user.id, ...data })
  })
