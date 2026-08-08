import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { config } from '@/server/config'

export class AgentBinaryNotConfiguredError extends Error {}
export class AgentBinaryUnsupportedPlatformError extends Error {}

const requiredDirectoryPlatforms = [
  { arch: 'amd64', os: 'linux' },
  { arch: 'arm64', os: 'linux' },
] as const
const supportedOperatingSystems: ReadonlyArray<string> = ['linux']
const supportedArchitectures: ReadonlyArray<string> = ['amd64', 'arm64']

export type AgentBinaryPlatform = {
  arch?: string | null
  os?: string | null
}

export type AgentBinary = {
  file: {
    size: number
  }
  filename: string
  path: string
}

export type AgentBinaryStatus =
  | {
      ready: true
      message: null
    }
  | {
      ready: false
      message: string
    }

export async function getAgentBinary(
  platform: AgentBinaryPlatform = {},
): Promise<AgentBinary> {
  const normalizedPlatform = normalizePlatform(platform)
  const path = getAgentBinaryPath(normalizedPlatform)

  if (!path) {
    throw new AgentBinaryNotConfiguredError(
      'Configure DEVPUSH_AGENT_BINARY_DIR before adding servers.',
    )
  }

  const file = await stat(path)

  if (!file.isFile()) {
    throw new Error('Configured agent binary path is not a file.')
  }

  await access(path, constants.R_OK | constants.X_OK)

  return { file, filename: binaryFilename(normalizedPlatform), path }
}

export async function getAgentBinaryStatus(): Promise<AgentBinaryStatus> {
  try {
    if (config.DEVPUSH_AGENT_BINARY_DIR) {
      await Promise.all(requiredDirectoryPlatforms.map(getAgentBinary))
    } else {
      await getAgentBinary()
    }

    return {
      ready: true,
      message: null,
    }
  } catch (error) {
    return {
      ready: false,
      message:
        error instanceof Error
          ? error.message
          : 'Unable to read configured agent binary.',
    }
  }
}

export async function getAgentBinaryChecksum(
  platform: AgentBinaryPlatform = {},
) {
  const binary = await getAgentBinary(platform)
  const digest = createHash('sha256')
    .update(await readFile(binary.path))
    .digest('hex')

  return { ...binary, digest }
}

function getAgentBinaryPath(platform: Required<AgentBinaryPlatform>) {
  if (config.DEVPUSH_AGENT_BINARY_DIR) {
    return join(config.DEVPUSH_AGENT_BINARY_DIR, binaryFilename(platform))
  }

  return undefined
}

function normalizePlatform({
  arch,
  os,
}: AgentBinaryPlatform): Required<AgentBinaryPlatform> {
  const normalizedOs = os ?? 'linux'
  const normalizedArch = arch ?? 'amd64'

  if (!supportedOperatingSystems.includes(normalizedOs)) {
    throw new AgentBinaryUnsupportedPlatformError(
      `Unsupported agent binary OS: ${normalizedOs}.`,
    )
  }

  if (!supportedArchitectures.includes(normalizedArch)) {
    throw new AgentBinaryUnsupportedPlatformError(
      `Unsupported agent binary architecture: ${normalizedArch}.`,
    )
  }

  return {
    arch: normalizedArch,
    os: normalizedOs,
  }
}

function binaryFilename({ arch, os }: Required<AgentBinaryPlatform>) {
  return `devpush-agent-${os}-${arch}`
}
