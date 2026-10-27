export const agentReleasePlatforms = Object.freeze([
  Object.freeze({
    os: 'linux',
    arch: 'amd64',
    filename: 'devpush-agent-linux-amd64',
  }),
  Object.freeze({
    os: 'linux',
    arch: 'arm64',
    filename: 'devpush-agent-linux-arm64',
  }),
])
const maxAgentBinaryBytes = 32 * 1024 * 1024

export function validateAgentRelease(value) {
  const fail = () => {
    throw new Error('Invalid agent release manifest.')
  }
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) fail()
  if (
    typeof value.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)
  )
    fail()
  if (
    typeof value.repository !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(
      value.repository,
    )
  )
    fail()
  if (
    typeof value.goVersion !== 'string' ||
    !/^go\d+\.\d+\.\d+$/.test(value.goVersion)
  )
    fail()
  if (!Number.isInteger(value.protocolVersion) || value.protocolVersion < 1)
    fail()
  if (
    !Array.isArray(value.capabilities) ||
    !value.capabilities.length ||
    value.capabilities.some(
      (item) => typeof item !== 'string' || !/^[a-z][a-z0-9.]+$/.test(item),
    ) ||
    new Set(value.capabilities).size !== value.capabilities.length
  )
    fail()
  if (
    !Array.isArray(value.assets) ||
    value.assets.length !== agentReleasePlatforms.length
  )
    fail()
  const assets = agentReleasePlatforms.map((platform) => {
    const matches = value.assets.filter(
      (asset) =>
        asset && asset.os === platform.os && asset.arch === platform.arch,
    )
    if (matches.length !== 1) fail()
    const asset = matches[0]
    if (
      asset.filename !== platform.filename ||
      typeof asset.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      fail()
    if (
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      asset.size > maxAgentBinaryBytes
    )
      fail()
    const url = `https://github.com/${value.repository}/releases/download/v${value.version}/${platform.filename}`
    if (asset.url !== url) fail()
    return Object.freeze({
      ...platform,
      url,
      sha256: asset.sha256,
      size: asset.size,
    })
  })
  return Object.freeze({
    schemaVersion: 1,
    repository: value.repository,
    version: value.version,
    goVersion: value.goVersion,
    protocolVersion: value.protocolVersion,
    capabilities: Object.freeze([...value.capabilities]),
    assets: Object.freeze(assets),
  })
}
