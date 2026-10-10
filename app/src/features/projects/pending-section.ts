export type ProjectPendingSection =
  | 'backup'
  | 'backups'
  | 'deployment'
  | 'deployments'
  | 'logs'
  | 'overview'
  | 'settings'

export function getProjectPendingSection(
  pathname: string,
): ProjectPendingSection {
  const segments = pathname.split('/').filter(Boolean)
  const projectsIndex = segments.findIndex(
    (segment, index) => index > 0 && segment === 'projects',
  )
  const [section, itemId] = segments.slice(projectsIndex + 2)

  if (section === 'settings') return 'settings'
  if (section === 'logs') return 'logs'
  if (section === 'backups') return itemId ? 'backup' : 'backups'
  if (section === 'deployments') {
    return itemId ? 'deployment' : 'deployments'
  }
  return 'overview'
}
