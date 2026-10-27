import { nodeBroadcaster } from '#devpush/server/realtime/node-broadcaster'

export function isCloudflareRuntime() {
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

export function getWorkspaceUpdates(): WorkspaceUpdatesNamespace | undefined {
  return nodeBroadcaster
}
