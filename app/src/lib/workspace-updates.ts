const connections = new Set<string>()
export type UpdateKind = 'deployments' | 'servers' | 'logs'

export function setWorkspaceConnected(slug: string, connected: boolean) {
  if (connected) connections.add(slug)
  else connections.delete(slug)
}

export function workspacePollInterval(slug: string, fallback: number) {
  return connections.has(slug) ? 60_000 : fallback
}

export function matchesWorkspaceUpdate(
  key: readonly unknown[],
  slug: string,
  kind?: UpdateKind,
) {
  if (key[1] !== slug) return false
  const family = String(key[0])
  if (!kind)
    return [
      'team-context',
      'project-context',
      'server-context',
      'deployment-context',
      'deployment-logs',
      'project-logs',
    ].includes(family)
  if (kind === 'logs') return family === 'project-logs'
  if (kind === 'servers')
    return (
      family === 'server-context' ||
      (family === 'team-context' &&
        ['shell', 'servers'].includes(String(key.at(-1)))) ||
      (family === 'project-context' && key.at(-1) === 'shell')
    )
  return (
    ['deployment-context', 'deployment-logs', 'project-logs'].includes(
      family,
    ) ||
    (family === 'team-context' && key.at(-1) === 'overview') ||
    (family === 'project-context' &&
      ['overview', 'deployments', 'shell', 'backups'].includes(
        String(key.at(-1)),
      ))
  )
}
