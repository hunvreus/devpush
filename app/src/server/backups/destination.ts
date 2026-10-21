import type { BackupDestination } from './service'

// Runs and queued jobs keep location/ownership, never credential copies.
export function backupDestinationSnapshot(destination: BackupDestination) {
  return {
    storageId: destination.storageId,
    bucket: destination.bucket,
    region: destination.region,
    endpoint: destination.endpoint,
    prefix: destination.prefix,
  }
}
