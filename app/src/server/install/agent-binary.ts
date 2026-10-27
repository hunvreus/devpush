import manifest from '../../../agent-release.json'
import {
  validateAgentRelease,
  agentReleasePlatforms,
} from '#devpush/lib/agent-release.mjs'
import {
  currentAgentCapabilities,
  currentAgentProtocolVersion,
} from '#devpush/server/agents/compatibility'
import {
  readReleasedAgentBinary,
  releasedAgentIsAvailable,
} from './release-binary'
import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { config } from '#devpush/server/config'

export class AgentBinaryNotConfiguredError extends Error {}
export class AgentBinaryUnsupportedPlatformError extends Error {}

const requiredDirectoryPlatforms = agentReleasePlatforms
const supportedOperatingSystems: ReadonlyArray<string> = [
  ...new Set(agentReleasePlatforms.map((platform) => platform.os)),
]
const supportedArchitectures: ReadonlyArray<string> = [
  ...new Set(agentReleasePlatforms.map((platform) => platform.arch)),
]
const release = validateAgentRelease(manifest)
if (
  release.protocolVersion !== currentAgentProtocolVersion ||
  currentAgentCapabilities.some(
    (capability) => !release.capabilities.includes(capability),
  )
)
  throw new Error('Pinned agent release does not support this control plane.')
let remoteAvailability: { expiresAt: number; ready: boolean } | undefined

export type AgentBinaryPlatform = {
  arch?: string | null
  os?: string | null
}

export type AgentBinary = {
  body: Buffer
  filename: string
  size: number
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
  const filename = binaryFilename(normalizedPlatform)

  const path = getAgentBinaryPath(normalizedPlatform)
  if (!path) {
    const asset = release.assets.find(
      (candidate) =>
        candidate.os === normalizedPlatform.os &&
        candidate.arch === normalizedPlatform.arch,
    )!
    const body = await readReleasedAgentBinary({
      release,
      asset,
    })
    return { body, filename, size: body.length }
  }

  const file = await stat(path)

  if (!file.isFile()) {
    throw new Error('Configured agent binary path is not a file.')
  }

  await access(path, constants.R_OK)

  const body = await readFile(path)
  return { body, filename, size: body.byteLength }
}

export async function getAgentBinaryMetadata(
  platform: AgentBinaryPlatform = {},
) {
  const normalized = normalizePlatform(platform)
  const filename = binaryFilename(normalized)
  const path = getAgentBinaryPath(normalized)
  if (path) {
    const file = await stat(path)
    if (!file.isFile())
      throw new Error('Configured agent binary path is not a file.')
    await access(path, constants.R_OK)
    return { filename, size: file.size }
  }
  const asset = release.assets.find(
    (candidate) =>
      candidate.os === normalized.os && candidate.arch === normalized.arch,
  )!
  if (
    !(await releasedAgentIsAvailable({
      release,
      asset,
    }))
  )
    throw new AgentBinaryNotConfiguredError(
      `Pinned agent release ${release.version} is unavailable.`,
    )
  return { filename, size: asset.size }
}

export async function getAgentBinaryStatus(): Promise<AgentBinaryStatus> {
  try {
    if (config.DEVPUSH_AGENT_BINARY_DIR) {
      await Promise.all(requiredDirectoryPlatforms.map(assertLocalBinary))
    } else {
      if (!remoteAvailability || remoteAvailability.expiresAt <= Date.now()) {
        const available = await Promise.all(
          release.assets.map((asset) =>
            releasedAgentIsAvailable({ release, asset }),
          ),
        )
        remoteAvailability = {
          expiresAt: Date.now() + 30_000,
          ready: available.every(Boolean),
        }
      }
      if (!remoteAvailability.ready)
        throw new AgentBinaryNotConfiguredError(
          `Pinned agent release ${release.version} is unavailable. Configure DEVPUSH_AGENT_BINARY_DIR for a local/offline build.`,
        )
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

async function assertLocalBinary(platform: Required<AgentBinaryPlatform>) {
  const path = getAgentBinaryPath(platform)
  if (!path) throw new AgentBinaryNotConfiguredError()
  const file = await stat(path)
  if (!file.isFile()) {
    throw new Error('Configured agent binary path is not a file.')
  }
  await access(path, constants.R_OK)
}

export async function getAgentBinaryChecksum(
  platform: AgentBinaryPlatform = {},
) {
  const normalized = normalizePlatform(platform)
  if (!config.DEVPUSH_AGENT_BINARY_DIR) {
    const asset = release.assets.find(
      (candidate) =>
        candidate.os === normalized.os && candidate.arch === normalized.arch,
    )!
    return { filename: asset.filename, size: asset.size, digest: asset.sha256 }
  }
  const binary = await getAgentBinary(platform)
  const digest = createHash('sha256').update(binary.body).digest('hex')

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

export function getAgentReleaseDownloadUrl(platform: AgentBinaryPlatform = {}) {
  const normalized = normalizePlatform(platform)
  if (getAgentBinaryPath(normalized)) return null
  return release.assets.find(
    (asset) => asset.os === normalized.os && asset.arch === normalized.arch,
  )!.url
}
