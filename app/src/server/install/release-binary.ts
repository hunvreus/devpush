import { createHash } from 'node:crypto'
import type {
  AgentRelease,
  AgentReleaseAsset,
} from '#devpush/lib/agent-release.mjs'

type ReleaseSource = {
  release: AgentRelease
  asset: AgentReleaseAsset
  fetcher?: typeof fetch
}

function verify(body: Buffer, asset: AgentReleaseAsset) {
  if (
    body.length !== asset.size ||
    createHash('sha256').update(body).digest('hex') !== asset.sha256
  )
    throw new Error(`Agent release integrity check failed: ${asset.filename}`)
  return body
}

export async function readReleasedAgentBinary({
  release,
  asset,
  fetcher = fetch,
}: ReleaseSource) {
  const response = await fetcher(asset.url, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok || !response.body)
    throw new Error(
      `Pinned agent release ${release.version} is unavailable (${response.status}).`,
    )
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > asset.size) {
        await reader.cancel()
        throw new Error('Agent release exceeds its pinned size.')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = verify(Buffer.concat(chunks), asset)
  return body
}

export async function releasedAgentIsAvailable({
  asset,
  fetcher = fetch,
}: ReleaseSource) {
  const response = await fetcher(asset.url, {
    method: 'HEAD',
    signal: AbortSignal.timeout(8000),
  })
  const size = response.headers.get('content-length')
  return response.ok && (size === null || Number(size) === asset.size)
}
