export type TeamPendingSection =
  | 'new-project'
  | 'overview'
  | 'project'
  | 'projects'
  | 'server'
  | 'servers'
  | 'settings'

export function getTeamPendingSection(pathname: string): TeamPendingSection {
  const [, section, itemId] = pathname.split('/').filter(Boolean)

  if (section === 'projects') return itemId ? 'project' : 'projects'
  if (section === 'new-project') return 'new-project'
  if (section === 'servers') return itemId ? 'server' : 'servers'
  if (section === 'settings') return 'settings'

  return 'overview'
}
