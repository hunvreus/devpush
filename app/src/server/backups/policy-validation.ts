import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  backupConfigSchema,
  normalizeBackupVolumes,
} from '#devpush/lib/backup-policy-schema'
import { getDefaultBackupPrefix } from '#devpush/lib/backup-paths'
import { PublicError } from '#devpush/lib/public-error'
import { db } from '#devpush/server/db'
import { environments } from '#devpush/server/db/schema'
import { resolveBackupDestination } from './storage'

const policySchema = backupConfigSchema.extend({ id: z.string().trim().min(1) })

export async function prepareBackupPolicy({
  teamId,
  projectId,
  policy,
}: {
  teamId: string
  projectId: string
  policy: unknown
}) {
  const parsed = policySchema.parse(policy)
  const [environment] = await db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.id, parsed.environmentId),
        eq(environments.projectId, projectId),
        eq(environments.status, 'active'),
      ),
    )
    .limit(1)
  if (!environment) throw new PublicError('BACKUP_ENVIRONMENT_INVALID')
  const normalized = {
    ...parsed,
    volumes: normalizeBackupVolumes(parsed.volumes),
    destination: {
      ...parsed.destination,
      prefix:
        parsed.destination.prefix ??
        getDefaultBackupPrefix(projectId, parsed.environmentId, parsed.id),
    },
  }
  if (normalized.destination.storageId || normalized.retention.remote.enabled) {
    await resolveBackupDestination(teamId, normalized.destination)
  }
  return normalized
}
