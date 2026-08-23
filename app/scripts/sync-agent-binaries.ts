import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { config } from '../src/server/config'
import {
  getObjectStore,
  isRemoteObjectStorageConfigured,
} from '../src/server/storage/object-store'

if (!isRemoteObjectStorageConfigured()) {
  process.exit(0)
}

if (!config.DEVPUSH_AGENT_BINARY_DIR) {
  throw new Error(
    'DEVPUSH_AGENT_BINARY_DIR is required to publish agent binaries to object storage.',
  )
}

for (const filename of [
  'devpush-agent-linux-amd64',
  'devpush-agent-linux-arm64',
]) {
  const body = await readFile(
    path.join(config.DEVPUSH_AGENT_BINARY_DIR, filename),
  )
  await getObjectStore().put(
    `agents/${filename}`,
    body,
    'application/octet-stream',
  )
  console.log(`Published agents/${filename}.`)
}
