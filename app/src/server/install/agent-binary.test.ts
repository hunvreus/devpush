import manifest from '../../../agent-release.json'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ body: 'verified agent fixture' }))
vi.mock('../../../agent-release.json', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof manifest }>()
  const { createHash } = await import('node:crypto')
  return {
    default: {
      ...actual.default,
      assets: actual.default.assets.map((asset) => ({
        ...asset,
        size: Buffer.byteLength(fixture.body),
        sha256: createHash('sha256').update(fixture.body).digest('hex'),
      })),
    },
  }
})
const tempDirs: Array<string> = []
const runtime = vi.hoisted(() => ({
  bucket: undefined as R2Bucket | undefined,
}))

vi.mock('#devpush/server/runtime/platform-env', () => ({
  getR2ObjectStore: () => runtime.bucket,
  isCloudflareRuntime: () => true,
}))

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  runtime.bucket = undefined

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

async function loadAgentBinaryModule({
  binaryDir,
}: {
  binaryDir?: string
} = {}) {
  vi.stubEnv('DEVPUSH_AGENT_BINARY_DIR', binaryDir ?? '')

  return await import('./agent-binary')
}

describe('agent binary status', () => {
  test('reports ready for readable executable platform files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devpush-agent-binary-'))
    tempDirs.push(dir)

    writeExecutable(join(dir, 'devpush-agent-linux-amd64'))
    writeExecutable(join(dir, 'devpush-agent-linux-arm64'))

    const { getAgentBinaryStatus } = await loadAgentBinaryModule({
      binaryDir: dir,
    })

    await expect(getAgentBinaryStatus()).resolves.toEqual({
      ready: true,
      message: null,
    })
  })

  test('serves readable binaries without requiring an executable source file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devpush-agent-binary-'))
    tempDirs.push(dir)

    const binary = join(dir, 'devpush-agent-linux-amd64')
    writeFileSync(binary, '#!/usr/bin/env sh\n')
    chmodSync(binary, 0o644)
    writeExecutable(join(dir, 'devpush-agent-linux-arm64'))

    const { getAgentBinaryStatus } = await loadAgentBinaryModule({
      binaryDir: dir,
    })

    await expect(getAgentBinaryStatus()).resolves.toEqual({
      ready: true,
      message: null,
    })
  })

  test('resolves platform binaries from the configured directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devpush-agent-binary-'))
    tempDirs.push(dir)

    writeExecutable(join(dir, 'devpush-agent-linux-amd64'))
    writeExecutable(join(dir, 'devpush-agent-linux-arm64'))

    const { getAgentBinary, getAgentBinaryStatus } =
      await loadAgentBinaryModule({
        binaryDir: dir,
      })

    await expect(getAgentBinaryStatus()).resolves.toEqual({
      ready: true,
      message: null,
    })
    await expect(
      getAgentBinary({ arch: 'arm64', os: 'linux' }),
    ).resolves.toMatchObject({
      body: Buffer.from('#!/usr/bin/env sh\n'),
      filename: 'devpush-agent-linux-arm64',
      size: 18,
    })
  })

  test('rejects unsupported platforms before reading the filesystem', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devpush-agent-binary-'))
    tempDirs.push(dir)

    writeExecutable(join(dir, 'devpush-agent-linux-amd64'))
    writeExecutable(join(dir, 'devpush-agent-linux-arm64'))

    const { AgentBinaryUnsupportedPlatformError, getAgentBinary } =
      await loadAgentBinaryModule({
        binaryDir: dir,
      })

    await expect(
      getAgentBinary({ arch: 's390x', os: 'linux' }),
    ).rejects.toBeInstanceOf(AgentBinaryUnsupportedPlatformError)
  })

  test('release downloads use GitHub even when R2 is configured', async () => {
    runtime.bucket = { get: vi.fn(), head: vi.fn() } as unknown as R2Bucket
    const { getAgentReleaseDownloadUrl, getAgentBinaryChecksum } =
      await loadAgentBinaryModule()
    expect(getAgentReleaseDownloadUrl({ arch: 'arm64' })).toBe(
      manifest.assets[1]!.url,
    )
    expect(await getAgentBinaryChecksum({ arch: 'arm64' })).toMatchObject({
      digest: manifest.assets[1]!.sha256,
    })
    expect(runtime.bucket.get).not.toHaveBeenCalled()
  })

  test('checks and briefly caches published release availability when no mirror is configured', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, {
          headers: {
            'content-length': String(Buffer.byteLength(fixture.body)),
          },
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { getAgentBinaryStatus } = await loadAgentBinaryModule()
    expect((await getAgentBinaryStatus()).ready).toBe(true)
    expect((await getAgentBinaryStatus()).ready).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every((call) => call[1]?.method === 'HEAD')).toBe(
      true,
    )
  })
})

function writeExecutable(path: string) {
  writeFileSync(path, '#!/usr/bin/env sh\n')
  chmodSync(path, 0o755)
}
