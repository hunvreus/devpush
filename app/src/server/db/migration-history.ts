export function assertKnownMigrationHistory(
  appliedHashes: string[],
  availableHashes: string[],
  hasUntrackedTables: boolean,
) {
  const known = new Set(availableHashes)
  if (hasUntrackedTables || appliedHashes.some((hash) => !known.has(hash))) {
    throw new Error(
      'Database migration history does not match this release. The flattened baseline requires fresh main and log databases; back up/export existing data before recreating them. No migration was applied.',
    )
  }
}
