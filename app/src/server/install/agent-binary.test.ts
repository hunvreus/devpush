import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const tempDirs: Array<string> = []

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()

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

  test('reports not ready when the binary is missing executable permissions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devpush-agent-binary-'))
    tempDirs.push(dir)

    const binary = join(dir, 'devpush-agent-linux-amd64')
    writeFileSync(binary, '#!/usr/bin/env sh\n')
    chmodSync(binary, 0o644)
    writeExecutable(join(dir, 'devpush-agent-linux-arm64'))

    const { getAgentBinaryStatus } = await loadAgentBinaryModule({
      binaryDir: dir,
    })

    const status = await getAgentBinaryStatus()

    expect(status.ready).toBe(false)
    expect(status.message).toMatch(/permission denied|access/i)
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
      filename: 'devpush-agent-linux-arm64',
      path: join(dir, 'devpush-agent-linux-arm64'),
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
})

function writeExecutable(path: string) {
  writeFileSync(path, '#!/usr/bin/env sh\n')
  chmodSync(path, 0o755)
}
