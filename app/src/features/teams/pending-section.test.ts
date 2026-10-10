import { describe, expect, it } from 'vitest'

import { getTeamPendingSection } from './pending-section'

describe('getTeamPendingSection', () => {
  const teamSlug = 'ronan-berder'

  it.each([
    [`/${teamSlug}`, 'overview'],
    [`/${teamSlug}/new-project`, 'new-project'],
    [`/${teamSlug}/projects`, 'projects'],
    [`/${teamSlug}/projects/devpush`, 'project'],
    [`/${teamSlug}/servers`, 'servers'],
    [`/${teamSlug}/servers/server-id`, 'server'],
    [`/${teamSlug}/settings`, 'settings'],
  ] as const)('maps %s to %s', (pathname, section) => {
    expect(getTeamPendingSection(pathname)).toBe(section)
  })
})
