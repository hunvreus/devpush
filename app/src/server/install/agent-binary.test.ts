import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const tempDirs: Array<string> = []
const runtime = vi.hoisted(() => ({
  bucket: undefined as R2Bucket | undefined,
}))

vi.mock('@/server/runtime/platform-env', () => ({
  getR2ObjectStore: () => runtime.bucket,
}))

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
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

  test('loads platform binaries from a Cloudflare R2 binding', async () => {
    runtime.bucket = {
      get: vi.fn(async (key: string) => ({
        arrayBuffer: async () =>
          Uint8Array.from(Buffer.from(`binary:${key}`)).buffer,
        httpMetadata: { contentType: 'application/octet-stream' },
      })),
    } as unknown as R2Bucket

    const { getAgentBinary } = await loadAgentBinaryModule()

    await expect(
      getAgentBinary({ arch: 'arm64', os: 'linux' }),
    ).resolves.toMatchObject({
      body: Buffer.from('binary:agents/devpush-agent-linux-arm64'),
      filename: 'devpush-agent-linux-arm64',
    })
  })
})

function writeExecutable(path: string) {
  writeFileSync(path, '#!/usr/bin/env sh\n')
  chmodSync(path, 0o755)
}
