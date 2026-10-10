import { z } from 'zod'

export const backupDatabaseEngines = [
  {
    value: 'postgres',
    label: 'PostgreSQL',
  },
  {
    value: 'mysql',
    label: 'MySQL',
  },
  {
    value: 'mariadb',
    label: 'MariaDB',
  },
  {
    value: 'mongo',
    label: 'MongoDB',
  },
] as const
const engineSchema = z.enum(backupDatabaseEngines.map((engine) => engine.value))
export const backupDatabaseSchema = z.object({
  service: z
    .string()
    .trim()
    .min(1, 'Select a database service.')
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/),
  engine: engineSchema,
  database: z.string().trim().max(128).default(''),
})
export const storedBackupDatabaseSchema = backupDatabaseSchema.extend({
  engine: z.enum([...engineSchema.options, 'needs_configuration']),
  legacyCommand: z.string().optional(),
})
export type BackupDatabase = z.infer<typeof storedBackupDatabaseSchema>
export function databaseBackupFilename(index: number, target: BackupDatabase) {
  return `${String(index + 1).padStart(2, '0')}-${target.service}.${target.engine === 'mongo' ? 'archive' : 'sql'}.gz`
}

export function databaseArtifactTarget(
  objectKey: string,
  targets: BackupDatabase[],
) {
  const filename = objectKey.split('/').at(-1)
  return targets.find(
    (target, index) => filename === databaseBackupFilename(index, target),
  )
}
