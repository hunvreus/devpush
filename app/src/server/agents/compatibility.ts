export const currentAgentProtocolVersion = 1

export const currentAgentCapabilities = [
  'jobs.compose.deploy.v1',
  'jobs.compose.cleanup.v2',
  'jobs.backup.v1',
  'jobs.backup.archive.v1',
  'jobs.backup.cleanup.v1',
  'jobs.restore.v1',
  'runtime.logs.v1',
  'metrics.history.v1',
  'ingress.certificates.v1',
] as const

export type AgentCapability = (typeof currentAgentCapabilities)[number]

export type AgentUpdate = {
  status: 'current' | 'available' | 'recommended' | 'required'
  latestVersion: string | null
  reason: string | null
}

export function getAgentUpdate({
  agentVersion,
  capabilities,
  latestVersion,
  protocolVersion,
  recommendedVersion,
}: {
  agentVersion: string | null
  capabilities: Array<string> | null
  latestVersion: string | null
  protocolVersion: number | null
  recommendedVersion: string | null
}): AgentUpdate {
  if (!canAgentRunDeployments({ capabilities, protocolVersion })) {
    return {
      status: 'required',
      latestVersion,
      reason:
        'This agent can connect, but it cannot run the current deployment protocol.',
    }
  }

  if (!capabilities?.includes('jobs.compose.cleanup.v2')) {
    return {
      status: 'required',
      latestVersion,
      reason: 'Update this agent to run cleanup jobs with attempt protection.',
    }
  }

  if (isOlderVersion(agentVersion, recommendedVersion) && recommendedVersion) {
    return {
      status: 'recommended',
      latestVersion,
      reason: `Agent ${recommendedVersion} or newer is recommended.`,
    }
  }

  if (isOlderVersion(agentVersion, latestVersion)) {
    return {
      status: 'available',
      latestVersion,
      reason: latestVersion ? `Agent ${latestVersion} is available.` : null,
    }
  }

  return { status: 'current', latestVersion, reason: null }
}

export function canAgentRunDeployments({
  capabilities,
  protocolVersion,
}: {
  capabilities: Array<string> | null
  protocolVersion: number | null
}) {
  return (
    protocolVersion === currentAgentProtocolVersion &&
    (capabilities?.includes('jobs.compose.deploy.v1') ?? false)
  )
}

export function hasAgentCapability(
  capabilities: Array<string> | undefined,
  capability: AgentCapability,
) {
  return capabilities?.includes(capability) ?? false
}

function isOlderVersion(current: string | null, target: string | null) {
  const currentParts = parseVersion(current)
  const targetParts = parseVersion(target)

  if (!currentParts || !targetParts) {
    return false
  }

  for (let index = 0; index < targetParts.length; index += 1) {
    const currentPart = currentParts[index]
    const targetPart = targetParts[index]
    if (currentPart === undefined || targetPart === undefined) return false
    const difference = currentPart - targetPart
    if (difference !== 0) {
      return difference < 0
    }
  }

  return false
}

function parseVersion(value: string | null) {
  const match = value?.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}
