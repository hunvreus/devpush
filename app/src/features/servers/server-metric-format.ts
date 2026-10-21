export function formatPercent(value: number | null) {
  if (value === null) {
    return 'Not reported'
  }

  return `${value.toFixed(1)}%`
}

export function formatByteRatio(used: number | null, total: number | null) {
  if (used === null || total === null || total <= 0) {
    return 'Not reported'
  }

  return `${formatBytes(used)} / ${formatBytes(total)}`
}

export function formatBytesPerSecond(value: number | null) {
  return value === null ? 'Not reported' : `${formatBytes(value)}/s`
}

export function formatNetworkSummary(
  received: number | null,
  sent: number | null,
) {
  if (received === null && sent === null) {
    return 'Not reported'
  }
  return `↓ ${formatBytesPerSecond(received)}  ↑ ${formatBytesPerSecond(sent)}`
}

export function formatBytePercent(used: number | null, total: number | null) {
  if (used === null || total === null || total <= 0) {
    return null
  }

  return (used / total) * 100
}

export function formatBytes(value: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let unitIndex = 0

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }

  return `${current.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}
