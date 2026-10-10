import { expect, test } from 'vitest'
import {
  matchesWorkspaceUpdate,
  setWorkspaceConnected,
  workspacePollInterval,
} from './workspace-updates'

test('polling recovers after a lost connection and isolates workspaces', () => {
  setWorkspaceConnected('a', true)
  expect(workspacePollInterval('a', 2000)).toBe(60000)
  expect(workspacePollInterval('b', 15000)).toBe(15000)
  setWorkspaceConnected('a', false)
  expect(workspacePollInterval('a', 2000)).toBe(2000)
})

test('notifications refresh relevant snapshots without touching settings or other workspaces', () => {
  expect(
    matchesWorkspaceUpdate(
      ['project-context', 'a', 'p', 'deployments'],
      'a',
      'deployments',
    ),
  ).toBe(true)
  expect(
    matchesWorkspaceUpdate(
      ['team-context', 'a', 'section', 'overview'],
      'a',
      'deployments',
    ),
  ).toBe(true)
  expect(
    matchesWorkspaceUpdate(
      ['project-context', 'b', 'p', 'deployments'],
      'a',
      'deployments',
    ),
  ).toBe(false)
  expect(
    matchesWorkspaceUpdate(
      ['project-context', 'a', 'p', 'settings'],
      'a',
      'deployments',
    ),
  ).toBe(false)
  expect(
    matchesWorkspaceUpdate(['server-context', 'a', 's'], 'a', 'servers'),
  ).toBe(true)
})
