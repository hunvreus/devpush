import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { backupStorageSchema } from '@/lib/backup-storage-schema'
import { requireAuthSession } from '@/server/auth/session.server'
import { saveBackupStorage, deleteBackupStorage } from './storage'
import { config } from '@/server/config'

export const saveBackupStorageAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({ teamSlug: z.string().min(1), input: backupStorageSchema })
      .parse(data),
  )
  .handler(async ({ data }) => {
    if (!config.DEVPUSH_BACKUPS_ENABLED)
      throw new Error('Backups are not enabled for this installation.')
    const session = await requireAuthSession()
    return saveBackupStorage({ userId: session.user.id, ...data })
  })

export const deleteBackupStorageAction = createServerFn({ method: 'POST' })
  .validator((data: unknown) =>
    z
      .object({ teamSlug: z.string().min(1), storageId: z.string().min(1) })
      .parse(data),
  )
  .handler(async ({ data }) => {
    if (!config.DEVPUSH_BACKUPS_ENABLED)
      throw new Error('Backups are not enabled for this installation.')
    const session = await requireAuthSession()
    return deleteBackupStorage({ userId: session.user.id, ...data })
  })
