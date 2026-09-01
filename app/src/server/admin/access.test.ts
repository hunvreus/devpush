import { describe, expect, test } from 'vitest'

import { matchesInstallationAdmin } from './access'

const candidate = { id: 'user-2', email: 'Admin@Example.com' }

describe('installation admin policy', () => {
  test('uses the configured email case-insensitively', () => {
    expect(
      matchesInstallationAdmin({
        candidate,
        configuredEmail: 'admin@example.com',
        firstUserId: 'user-1',
      }),
    ).toBe(true)
  })

  test('falls back to the first user when no email is configured', () => {
    expect(matchesInstallationAdmin({ candidate, firstUserId: 'user-2' })).toBe(
      true,
    )
    expect(matchesInstallationAdmin({ candidate, firstUserId: 'user-1' })).toBe(
      false,
    )
  })
})
