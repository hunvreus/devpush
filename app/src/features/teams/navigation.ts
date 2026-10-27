import type { SectionNavigationItem } from '#devpush/components/section-navigation'

import { backupsEnabled } from '#devpush/lib/backup-feature'

export const teamSettingsNavigationItems: Array<SectionNavigationItem> = [
  { href: '#general', label: 'General' },
  { href: '#members', label: 'Members' },
  ...(backupsEnabled
    ? [{ href: '#backup-storage' as const, label: 'Backup storage' }]
    : []),
  { href: '#notifications', label: 'My notifications' },
  { href: '#danger', label: 'Danger', destructive: true },
]

export const teamTabs = [
  { label: 'Overview', to: '/$teamSlug' },
  { label: 'Projects', to: '/$teamSlug/projects' },
  { label: 'Servers', to: '/$teamSlug/servers' },
  { label: 'Settings', to: '/$teamSlug/settings' },
] as const

const allProjectTabs = [
  { label: 'Overview', to: '/$teamSlug/projects/$projectName' },
  {
    label: 'Deployments',
    to: '/$teamSlug/projects/$projectName/deployments',
  },
  { label: 'Logs', to: '/$teamSlug/projects/$projectName/logs' },
  { label: 'Backups', to: '/$teamSlug/projects/$projectName/backups' },
  { label: 'Settings', to: '/$teamSlug/projects/$projectName/settings' },
] as const

export const projectTabs = allProjectTabs.filter(
  (tab) => backupsEnabled || tab.label !== 'Backups',
)

export function isProjectTabActive(pathname: string, label: string) {
  const segments = pathname.split('/').filter(Boolean)
  const projectsIndex = segments.findIndex(
    (segment, index) => index > 0 && segment === 'projects',
  )
  const section = segments[projectsIndex + 2] ?? 'overview'

  return section === label.toLowerCase()
}

export function isTeamTabActive(pathname: string, label: string) {
  const section = pathname.split('/').filter(Boolean)[1] ?? 'overview'
  if (label === 'Projects' && section === 'new-project') return true
  return section === label.toLowerCase()
}
