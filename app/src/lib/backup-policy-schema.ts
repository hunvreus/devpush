import { backupDatabaseSchema } from './backup-database'
import { backupStorageReferenceSchema } from './backup-storage-schema'
import { z } from 'zod'
import { backupResourceNameSchema } from './backup-resource-schema'
import { isValidCron } from '#devpush/lib/backup-cron'

export const backupScheduleSchema = z.object({
  cron: z
    .string()
    .trim()
    .refine(isValidCron, 'Enter a valid five-field cron expression.'),
})

export const backupVolumesSchema = z.object({
  mode: z.enum(['none', 'allNamed', 'selected']),
  names: z.array(backupResourceNameSchema),
})

export const backupRetentionSchema = z.object({
  local: z.object({
    count: z
      .number()
      .int('Enter a whole number.')
      .min(0, 'Enter zero or a positive number.')
      .max(10_000, 'Keep no more than 10,000 backups.'),
    days: z
      .number()
      .int('Enter a whole number.')
      .min(0, 'Enter zero or a positive number.')
      .max(3650, 'Retention must be 3,650 days or fewer.'),
    maxStorageGb: z
      .number()
      .min(0, 'Enter zero or a positive number.')
      .max(100_000, 'Storage must be 100,000 GB or less.'),
  }),
  remote: z.object({
    enabled: z.boolean(),
    count: z
      .number()
      .int('Enter a whole number.')
      .min(0, 'Enter zero or a positive number.')
      .max(10_000, 'Keep no more than 10,000 backups.'),
    days: z
      .number()
      .int('Enter a whole number.')
      .min(0, 'Enter zero or a positive number.')
      .max(3650, 'Retention must be 3,650 days or fewer.'),
    maxStorageGb: z
      .number()
      .min(0, 'Enter zero or a positive number.')
      .max(100_000, 'Storage must be 100,000 GB or less.'),
  }),
})

export const backupConfigSchema = z.object({
  id: z.string().trim().optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Enter a backup policy name.')
    .max(100, 'Backup policy names must be 100 characters or fewer.'),
  environmentId: z.string().trim().min(1),
  enabled: z.boolean(),
  schedule: backupScheduleSchema,
  destination: backupStorageReferenceSchema,
  retention: backupRetentionSchema,
  volumes: backupVolumesSchema,
  databaseDumps: z.array(backupDatabaseSchema),
})

export type BackupPolicyInput = z.infer<typeof backupConfigSchema>

export function normalizeBackupVolumes(
  value: unknown,
): z.infer<typeof backupVolumesSchema> {
  const parsed = backupVolumesSchema.safeParse(value)
  if (
    !parsed.success ||
    parsed.data.mode === 'allNamed' ||
    (parsed.data.mode === 'selected' && parsed.data.names.length === 0)
  ) {
    return { mode: 'allNamed', names: [] }
  }
  return parsed.data.mode === 'none' ? { mode: 'none', names: [] } : parsed.data
}
