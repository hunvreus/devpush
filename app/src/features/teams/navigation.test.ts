import { describe, expect, test } from 'vitest'

import {
  isProjectTabActive,
  isTeamTabActive,
  projectTabs,
  teamTabs,
} from './navigation'

describe('team navigation state', () => {
  test.each([
    ['/ronan-berder', 'Overview'],
    ['/ronan-berder/projects', 'Projects'],
    ['/ronan-berder/new-project', 'Projects'],
    ['/ronan-berder/servers', 'Servers'],
    ['/ronan-berder/settings', 'Settings'],
  ])('selects %s as %s', (pathname, selected) => {
    expect(
      teamTabs.filter((tab) => isTeamTabActive(pathname, tab.label)),
    ).toEqual([expect.objectContaining({ label: selected })])
  })

  test.each([
    ['/ronan-berder/projects/devpush', 'Overview'],
    ['/ronan-berder/projects/devpush/deployments', 'Deployments'],
    ['/ronan-berder/projects/devpush/deployments/edf916d', 'Deployments'],
    ['/ronan-berder/projects/devpush/logs', 'Logs'],
    ['/ronan-berder/projects/devpush/settings', 'Settings'],
    ['/ronan-berder/projects/logs', 'Overview'],
    ['/ronan-berder/projects/settings', 'Overview'],
  ])('selects %s as %s', (pathname, selected) => {
    expect(
      projectTabs.filter((tab) => isProjectTabActive(pathname, tab.label)),
    ).toEqual([expect.objectContaining({ label: selected })])
  })
})
