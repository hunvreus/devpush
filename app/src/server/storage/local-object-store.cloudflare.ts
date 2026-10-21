import type { ObjectStore } from './object-store'

export function createLocalObjectStore(): ObjectStore {
  throw new Error(
    'Object storage is not configured. Cloudflare requires an R2 binding or S3-compatible storage.',
  )
}
