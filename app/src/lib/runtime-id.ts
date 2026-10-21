export function buildRuntimeId({
  environmentId,
  projectId,
}: {
  environmentId: string
  projectId: string
}) {
  return `dp_${shortRuntimeId(projectId)}_${shortRuntimeId(environmentId)}`
}

function shortRuntimeId(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '')

  if (normalized.length >= 10) {
    return normalized.slice(0, 10)
  }

  return normalized.padEnd(10, '0')
}
