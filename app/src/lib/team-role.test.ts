import { describe, expect, test } from 'vitest'

import {
  canDeleteTeam,
  canManageTeamMembers,
  canManageTeamSettings,
} from './team-role'
import type { TeamRole } from './team-role'

describe('team role policy', () => {
  test.each<TeamRole>(['owner', 'admin'])(
    'allows %s to manage general team settings and invites',
    (role) => {
      expect(canManageTeamSettings(role)).toBe(true)
    },
  )

  test.each<TeamRole>(['owner', 'admin'])(
    'allows %s to manage team members',
    (role) => {
      expect(canManageTeamMembers(role)).toBe(true)
    },
  )

  test('limits team deletion to owners', () => {
    expect(canDeleteTeam('owner')).toBe(true)

    for (const role of ['admin', 'member'] as const) {
      expect(canDeleteTeam(role)).toBe(false)
    }
  })

  test('does not allow members to manage team settings', () => {
    expect(canManageTeamSettings('member')).toBe(false)
    expect(canManageTeamMembers('member')).toBe(false)
  })
})
