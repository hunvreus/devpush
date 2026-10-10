import { and, asc, eq, sql } from 'drizzle-orm'
import { backupStorageSchema } from '@/lib/backup-storage-schema'
import type {
  BackupStorageInput,
  BackupStorageSummary,
  BackupStorageReference,
} from '@/lib/backup-storage-schema'
import { db } from '@/server/db'
import {
  backupStorage,
  backupConfigs,
  backupRuns,
  backupArtifacts,
} from '@/server/db/schema'
import { encryptSecret } from '@/server/secrets/crypto'
import { requireTeam, requireTeamManager } from '@/server/teams/service'
import type { BackupDestination } from './service'

export async function listBackupStorage(
  teamId: string,
  includeAccessKey = false,
): Promise<BackupStorageSummary[]> {
  const rows = await db
    .select({
      id: backupStorage.id,
      name: backupStorage.name,
      bucket: backupStorage.bucket,
      region: backupStorage.region,
      endpoint: backupStorage.endpoint,
      accessKeyId: backupStorage.accessKeyId,
    })
    .from(backupStorage)
    .where(eq(backupStorage.teamId, teamId))
    .orderBy(asc(backupStorage.name))
  return rows.map(({ accessKeyId, ...row }) => ({
    ...row,
    hasSecret: true,
    ...(includeAccessKey ? { accessKeyId } : {}),
  }))
}

export async function getBackupStorage({
  userId,
  teamSlug,
}: {
  userId: string
  teamSlug: string
}) {
  const team = await requireTeam(userId, teamSlug)
  return listBackupStorage(team.id, team.role !== 'member')
}

export async function saveBackupStorage({
  userId,
  teamSlug,
  input,
}: {
  userId: string
  teamSlug: string
  input: BackupStorageInput
}) {
  const team = await requireTeamManager(userId, teamSlug)
  const parsed = backupStorageSchema.parse(input)
  const existing = parsed.id
    ? (
        await db
          .select()
          .from(backupStorage)
          .where(
            and(
              eq(backupStorage.id, parsed.id),
              eq(backupStorage.teamId, team.id),
            ),
          )
          .limit(1)
      ).at(0)
    : undefined
  if (parsed.id && !existing) throw new Error('Backup storage not found.')
  if (!existing && !parsed.secretAccessKey)
    throw new Error('Enter a secret access key.')
  // Location is immutable: create another destination to move new backups.
  if (
    existing &&
    (existing.bucket !== parsed.bucket ||
      existing.region !== parsed.region ||
      (existing.endpoint ?? '') !== parsed.endpoint)
  )
    throw new Error(
      'Create another storage destination to change its bucket, region or endpoint.',
    )
  const now = new Date()
  const values = {
    name: parsed.name,
    bucket: parsed.bucket,
    region: parsed.region,
    endpoint: parsed.endpoint || null,
    accessKeyId: parsed.accessKeyId,
    secretAccessKeyCiphertext: parsed.secretAccessKey
      ? encryptSecret(parsed.secretAccessKey)
      : existing!.secretAccessKeyCiphertext,
    updatedAt: now,
  }
  if (existing) {
    await db
      .update(backupStorage)
      .set(values)
      .where(
        and(
          eq(backupStorage.id, existing.id),
          eq(backupStorage.teamId, team.id),
        ),
      )
  } else {
    await db.insert(backupStorage).values({
      id: crypto.randomUUID(),
      teamId: team.id,
      ...values,
      createdAt: now,
    })
  }
  return listBackupStorage(team.id, true)
}

export async function resolveBackupDestination(
  teamId: string,
  reference: BackupStorageReference,
): Promise<BackupDestination> {
  if (!reference.storageId)
    throw new Error('Select a workspace backup storage destination.')
  const row = (
    await db
      .select()
      .from(backupStorage)
      .where(
        and(
          eq(backupStorage.id, reference.storageId),
          eq(backupStorage.teamId, teamId),
        ),
      )
      .limit(1)
  ).at(0)
  if (!row)
    throw new Error('Select a backup storage destination in this workspace.')
  return {
    storageId: row.id,
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint ?? undefined,
    prefix: reference.prefix,
    accessKeyId: row.accessKeyId,
    secretAccessKeyCiphertext: row.secretAccessKeyCiphertext,
  }
}

export async function refreshBackupCredentials(
  teamId: string,
  snapshot: BackupDestination,
): Promise<BackupDestination> {
  if (!snapshot.storageId) return snapshot
  const current = await resolveBackupDestination(teamId, {
    storageId: snapshot.storageId,
  })
  return {
    ...snapshot,
    accessKeyId: current.accessKeyId,
    secretAccessKeyCiphertext: current.secretAccessKeyCiphertext,
  }
}

export async function deleteBackupStorage({
  userId,
  teamSlug,
  storageId,
}: {
  userId: string
  teamSlug: string
  storageId: string
}) {
  const team = await requireTeamManager(userId, teamSlug)
  // References are tested in the deletion statement, never against a stale UI snapshot.
  const deleted = await db
    .delete(backupStorage)
    .where(
      and(
        eq(backupStorage.id, storageId),
        eq(backupStorage.teamId, team.id),
        sql`not exists (select 1 from ${backupConfigs} where json_extract(${backupConfigs.destination}, '$.storageId') = ${storageId})`,
        sql`not exists (select 1 from ${backupRuns} where json_extract(${backupRuns.destination}, '$.storageId') = ${storageId}
      and (${backupRuns.status} in ('queued', 'running') or exists
        (select 1 from ${backupArtifacts} where ${backupArtifacts.backupRunId} = ${backupRuns.id} and ${backupArtifacts.storage} = 'remote')))`,
      ),
    )
    .returning({ id: backupStorage.id })
  if (!deleted.length)
    throw new Error(
      'Storage cannot be removed while a policy, active backup or retained remote backup references it.',
    )
  return listBackupStorage(team.id, true)
}
