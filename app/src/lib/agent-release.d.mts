export type AgentReleaseAsset = Readonly<{
  os: 'linux'
  arch: 'amd64' | 'arm64'
  filename: string
  url: string
  sha256: string
  size: number
}>
export type AgentRelease = Readonly<{
  schemaVersion: 1
  repository: string
  version: string
  goVersion: string
  protocolVersion: number
  capabilities: readonly string[]
  assets: readonly AgentReleaseAsset[]
}>
export const agentReleasePlatforms: readonly Readonly<
  Pick<AgentReleaseAsset, 'os' | 'arch' | 'filename'>
>[]
export function validateAgentRelease(value: unknown): AgentRelease
