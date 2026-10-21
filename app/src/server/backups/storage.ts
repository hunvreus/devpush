import {
  saveBackupStorageState,
  deleteBackupStorageState,
} from './storage-state'
import { requireBackupsEnabled } from '@/server/backups/feature'
import { PublicError } from '@/lib/public-error'
import { and, asc, eq } from 'drizzle-orm'
import { backupStorageSchema } from '@/lib/backup-storage-schema'
import type {
  BackupStorageInput,
  BackupStorageSummary,
  BackupStorageReference,
} from '@/lib/backup-storage-schema'
import { db } from '@/server/db'
import { backupStorage } from '@/server/db/schema'
import { encryptSecret } from '@/server/secrets/crypto'
import { requireTeam, requireTeamManager } from '@/server/teams/service'
import type { BackupDestination } from './service'

export async function listBackupStorage(
  teamId: string,
  includeAccessKey = false,
): Promise<BackupStorageSummary[]> {
  const rows = await db
    .select({
      settingsVersion: backupStorage.settingsVersion,
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
  settingsVersion,
}: {
  userId: string
  teamSlug: string
  settingsVersion?: number | null
  input: BackupStorageInput
}) {
  requireBackupsEnabled()
  const team = await requireTeamManager(userId, teamSlug)
  const prepared = await prepareBackupStorage({
    teamId: team.id,
    input,
    settingsVersion,
  })
  const changed = await saveBackupStorageState(db, {
    teamId: team.id,
    userId,
    storageId: prepared.id,
    settingsVersion: prepared.settingsVersion,
    values: prepared.values,
    now: new Date(),
  })
  if (!changed)
    throw new PublicError(
      prepared.settingsVersion === null ? 'FORBIDDEN' : 'SETTINGS_CONFLICT',
    )
  return listBackupStorage(team.id, true)
}

export async function resolveBackupDestination(
  teamId: string,
  reference: BackupStorageReference,
): Promise<BackupDestination> {
  if (!reference.storageId) throw new PublicError('BACKUP_STORAGE_REQUIRED')
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
  if (!row) throw new PublicError('BACKUP_STORAGE_TEAM_MISMATCH')
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
  if (!snapshot.storageId) throw new PublicError('BACKUP_STORAGE_REQUIRED')
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
  settingsVersion,
}: {
  userId: string
  teamSlug: string
  settingsVersion?: number
  storageId: string
}) {
  requireBackupsEnabled()
  const team = await requireTeamManager(userId, teamSlug)
  const current = await getOwnedBackupStorage(team.id, storageId)
  if (!current) throw new PublicError('BACKUP_STORAGE_NOT_FOUND')
  const expectedVersion = settingsVersion ?? current.settingsVersion
  if (expectedVersion !== current.settingsVersion)
    throw new PublicError('SETTINGS_CONFLICT')
  const changed = await deleteBackupStorageState(db, {
    teamId: team.id,
    userId,
    storageId,
    settingsVersion: expectedVersion,
  })
  if (!changed) {
    await requireTeamManager(userId, teamSlug)
    const latest = await getOwnedBackupStorage(team.id, storageId)
    if (!latest || latest.settingsVersion !== expectedVersion)
      throw new PublicError('SETTINGS_CONFLICT')
    throw new PublicError('BACKUP_STORAGE_IN_USE')
  }
  return listBackupStorage(team.id, true)
}

export async function getOwnedBackupStorage(teamId: string, storageId: string) {
  const [row] = await db
    .select()
    .from(backupStorage)
    .where(
      and(eq(backupStorage.id, storageId), eq(backupStorage.teamId, teamId)),
    )
    .limit(1)
  return row
}

export async function prepareBackupStorage({
  teamId,
  input,
  settingsVersion,
  newStorageId,
}: {
  teamId: string
  input: unknown
  settingsVersion?: number | null
  newStorageId?: string
}) {
  const parsed = backupStorageSchema.parse(input)
  const existing = parsed.id
    ? await getOwnedBackupStorage(teamId, parsed.id)
    : undefined
  if (parsed.id && !existing) throw new PublicError('BACKUP_STORAGE_NOT_FOUND')
  if (!existing && !parsed.secretAccessKey)
    throw new PublicError('BACKUP_STORAGE_SECRET_REQUIRED')
  if (
    existing &&
    (existing.bucket !== parsed.bucket ||
      existing.region !== parsed.region ||
      (existing.endpoint ?? '') !== parsed.endpoint)
  ) {
    throw new PublicError('BACKUP_STORAGE_LOCATION_IMMUTABLE')
  }
  const expectedVersion = existing
    ? (settingsVersion ?? existing.settingsVersion)
    : null
  if (existing && expectedVersion !== existing.settingsVersion)
    throw new PublicError('SETTINGS_CONFLICT')
  return {
    id: existing?.id ?? newStorageId ?? crypto.randomUUID(),
    settingsVersion: expectedVersion,
    values: {
      name: parsed.name,
      bucket: parsed.bucket,
      region: parsed.region,
      endpoint: parsed.endpoint || null,
      accessKeyId: parsed.accessKeyId,
      secretAccessKeyCiphertext: parsed.secretAccessKey
        ? encryptSecret(parsed.secretAccessKey)
        : existing!.secretAccessKeyCiphertext,
    },
  }
}
