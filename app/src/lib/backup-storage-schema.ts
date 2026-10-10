import { z } from 'zod'

const singleLine = z
  .string()
  .trim()
  .refine((value) => !/[\r\n\0]/.test(value), 'Enter a single-line value.')
export const backupStorageSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, 'Enter a storage name.').max(100),
  bucket: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(
      /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
      'Enter a DNS-compatible bucket name.',
    ),
  region: singleLine.min(1).max(100),
  endpoint: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .url()
      .refine(
        (value) => ['http:', 'https:'].includes(new URL(value).protocol),
        'Use an HTTP or HTTPS endpoint.',
      ),
  ]),
  accessKeyId: singleLine.min(1, 'Enter an access key ID.').max(256),
  secretAccessKey: singleLine.max(1024),
})
export type BackupStorageInput = z.infer<typeof backupStorageSchema>
export type BackupStorageSummary = {
  id: string
  name: string
  bucket: string
  region: string
  endpoint: string | null
  accessKeyId?: string
  hasSecret: boolean
}
export type BackupStorageReference = { storageId?: string; prefix?: string }
export const backupStorageReferenceSchema = z.object({
  storageId: z.string().trim().min(1).optional(),
  prefix: singleLine
    .max(512)
    .refine(
      (value) => !value.split('/').includes('..'),
      'Object prefixes cannot contain .. segments.',
    )
    .optional(),
})
