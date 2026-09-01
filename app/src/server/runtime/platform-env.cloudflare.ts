import { env } from 'cloudflare:workers'

export function getDatabaseConnectionString() {
  return env.DEVPUSH_DATABASE.connectionString
}

export function requiresRequestScopedDatabase() {
  return true
}

export function getR2ObjectStore() {
  return env.DEVPUSH_OBJECTS
}

export function getWorkerVersionMetadata() {
  return env.CF_VERSION_METADATA
}
