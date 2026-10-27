import type {
  BackupCleanupJobPayload,
  BackupJobPayload,
  BackupRestoreJobPayload,
} from '#devpush/server/backups/service'
import type { DeprovisionJobPayload } from './cleanup'

export function parseDeprovisionPayload(
  value: unknown,
): DeprovisionJobPayload | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    !('runtimeIds' in value) ||
    !('removeVolumes' in value) ||
    !('reason' in value)
  ) {
    return null
  }

  const payload = value as Record<string, unknown>

  if (
    payload.schemaVersion !== 1 ||
    !Array.isArray(payload.runtimeIds) ||
    typeof payload.removeVolumes !== 'boolean' ||
    typeof payload.reason !== 'string'
  ) {
    return null
  }

  const runtimeIds = payload.runtimeIds.filter(
    (runtimeId): runtimeId is string =>
      typeof runtimeId === 'string' && runtimeId.trim() !== '',
  )

  if (runtimeIds.length === 0) {
    return null
  }

  return {
    schemaVersion: 1,
    runtimeIds: Array.from(new Set(runtimeIds)).sort(),
    removeVolumes: payload.removeVolumes,
    reason: payload.reason,
  }
}

export function parseBackupPayload(value: unknown): BackupJobPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const payload = value as Record<string, unknown>

  if (
    payload.schemaVersion !== 1 ||
    typeof payload.backupRunId !== 'string' ||
    typeof payload.artifactPrefix !== 'string' ||
    typeof payload.localBasePath !== 'string' ||
    typeof payload.projectId !== 'string' ||
    typeof payload.environmentId !== 'string' ||
    typeof payload.runtimeId !== 'string' ||
    !isRecord(payload.destination) ||
    !isRecord(payload.retention) ||
    !isRecord(payload.volumes) ||
    !Array.isArray(payload.databaseDumps)
  ) {
    return null
  }

  return payload as BackupJobPayload
}

export function parseBackupCleanupPayload(
  value: unknown,
): BackupCleanupJobPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const payload = value as Record<string, unknown>

  if (
    payload.schemaVersion !== 1 ||
    !Array.isArray(payload.backupRunIds) ||
    !Array.isArray(payload.localObjectKeys) ||
    !Array.isArray(payload.remoteObjectKeys) ||
    typeof payload.reason !== 'string'
  ) {
    return null
  }

  if (payload.remoteObjectKeys.length > 0 && !payload.destination) {
    return null
  }

  return payload as BackupCleanupJobPayload
}

export function parseRestorePayload(
  value: unknown,
): BackupRestoreJobPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const payload = value as Record<string, unknown>

  if (
    payload.schemaVersion !== 1 ||
    typeof payload.backupRunId !== 'string' ||
    typeof payload.projectId !== 'string' ||
    typeof payload.environmentId !== 'string' ||
    typeof payload.runtimeId !== 'string' ||
    !Array.isArray(payload.artifacts) ||
    payload.artifacts.length === 0
  ) {
    return null
  }

  for (const artifact of payload.artifacts) {
    if (
      !isRecord(artifact) ||
      typeof artifact.id !== 'string' ||
      typeof artifact.objectKey !== 'string' ||
      typeof artifact.checksumSha256 !== 'string' ||
      (artifact.storage !== 'local' && artifact.storage !== 'remote')
    ) {
      return null
    }

    if (artifact.type === 'volume') {
      if (typeof artifact.targetVolume !== 'string') {
        return null
      }
    } else if (artifact.type === 'database') {
      if (
        typeof artifact.targetService !== 'string' ||
        typeof artifact.restoreCommand !== 'string'
      ) {
        return null
      }
    } else {
      return null
    }

    if (artifact.storage === 'remote' && !payload.destination) {
      return null
    }
  }

  return payload as BackupRestoreJobPayload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
