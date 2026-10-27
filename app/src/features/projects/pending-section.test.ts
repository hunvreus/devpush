import { describe, expect, it } from 'vitest'

import { getProjectPendingSection } from '#devpush/features/projects/pending-section'

describe('getProjectPendingSection', () => {
  it.each([
    ['/team/projects/project', 'overview'],
    ['/team/projects/project/deployments', 'deployments'],
    ['/team/projects/project/deployments/deployment-id', 'deployment'],
    ['/team/projects/project/logs', 'logs'],
    ['/team/projects/project/settings', 'settings'],
    ['/team/projects/project/backups', 'backups'],
    ['/team/projects/project/backups/backup-id', 'backup'],
    ['/team/projects/logs', 'overview'],
    ['/team/projects/settings', 'overview'],
    ['/team/projects/backups', 'overview'],
    ['/backups/projects/project', 'overview'],
    ['/backups/projects/project/settings', 'settings'],
  ] as const)('maps %s to %s', (pathname, section) => {
    expect(getProjectPendingSection(pathname)).toBe(section)
  })
})
