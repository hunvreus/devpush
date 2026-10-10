import { backupDatabaseSchema } from './backup-database'
import { backupStorageReferenceSchema } from './backup-storage-schema'
import { z } from 'zod'
import { isValidCron } from '@/server/backups/cron'

export const backupScheduleSchema = z.object({
  cron: z
    .string()
    .trim()
    .refine(isValidCron, 'Enter a valid five-field cron expression.'),
})

const backupVolumesSchema = z.object({
  mode: z.enum(['none', 'allNamed', 'selected']),
  names: z.array(
    z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        'Backup volume names can only contain letters, numbers, dots, underscores, and hyphens.',
      ),
  ),
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
  retention: z.object({
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
  }),
  volumes: backupVolumesSchema,
  databaseDumps: z.array(backupDatabaseSchema),
})
