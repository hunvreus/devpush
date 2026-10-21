import { describe, expect, test } from 'vitest'

import { canDeleteProject, canDeleteTeam } from './delete-policy'

describe('delete policy', () => {
  test('blocks deleting teams used as another user default', () => {
    expect(canDeleteTeam({ defaultUserIds: ['user-a'] })).toBe(false)
    expect(
      canDeleteTeam({
        defaultUserIds: ['user-a', 'user-b'],
      }),
    ).toBe(false)
  })

  test('allows deleting a team with no default users', () => {
    expect(canDeleteTeam({ defaultUserIds: [] })).toBe(true)
  })

  test('allows project deletion for owners and admins only', () => {
    expect(canDeleteProject('owner')).toBe(true)
    expect(canDeleteProject('admin')).toBe(true)
    expect(canDeleteProject('member')).toBe(false)
  })
})
