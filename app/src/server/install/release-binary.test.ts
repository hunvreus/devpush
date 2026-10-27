import { createHash } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { validateAgentRelease } from '#devpush/lib/agent-release.mjs'
import {
  readReleasedAgentBinary,
  releasedAgentIsAvailable,
} from './release-binary'

const body = Buffer.from('verified agent bytes')
const release = validateAgentRelease({
  schemaVersion: 1,
  repository: 'example/devpush',
  version: '1.2.3',
  goVersion: 'go1.27.0',
  protocolVersion: 1,
  capabilities: ['ingress.certificates.v1'],
  assets: ['amd64', 'arm64'].map((arch) => ({
    os: 'linux',
    arch,
    filename: `devpush-agent-linux-${arch}`,
    url: `https://github.com/example/devpush/releases/download/v1.2.3/devpush-agent-linux-${arch}`,
    size: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  })),
})
const asset = release.assets[0]!
test('downloads and verifies pinned GitHub bytes without object storage', async () => {
  const fetcher = vi.fn(async () => new Response(body))
  expect(await readReleasedAgentBinary({ release, asset, fetcher })).toEqual(
    body,
  )
  expect(fetcher).toHaveBeenCalledWith(
    asset.url,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
})
test.each(['oversized', 'short', 'wrong-hash', 'missing'])(
  'rejects %s downloads without caching them',
  async (kind) => {
    const response =
      kind === 'missing'
        ? new Response(null, { status: 404 })
        : new Response(
            kind === 'oversized'
              ? Buffer.concat([body, body])
              : kind === 'short'
                ? body.subarray(1)
                : Buffer.alloc(body.length),
          )
    await expect(
      readReleasedAgentBinary({
        release,
        asset,
        fetcher: vi.fn(async () => response),
      }),
    ).rejects.toThrow()
  },
)
test('availability checks use GitHub metadata without downloading bytes', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(null, {
        headers: { 'content-length': String(body.length) },
      }),
  )
  expect(await releasedAgentIsAvailable({ release, asset, fetcher })).toBe(true)
  expect(fetcher).toHaveBeenCalledWith(
    asset.url,
    expect.objectContaining({ method: 'HEAD' }),
  )
})
