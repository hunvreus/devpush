import { env } from 'cloudflare:workers'

export function isCloudflareRuntime() {
  return true
}

export function getR2ObjectStore() {
  return env.DEVPUSH_OBJECTS
}

export function getWorkerVersionMetadata() {
  return env.CF_VERSION_METADATA
}

export function getWorkspaceUpdates() {
  return env.DEVPUSH_WORKSPACE_UPDATES
}
