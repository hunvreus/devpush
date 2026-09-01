export function getDatabaseConnectionString() {
  return process.env.DATABASE_URL
}

export function requiresRequestScopedDatabase() {
  return false
}

export function getR2ObjectStore(): R2Bucket | undefined {
  return undefined
}

export function getWorkerVersionMetadata():
  | { id: string; tag: string }
  | undefined {
  return undefined
}
