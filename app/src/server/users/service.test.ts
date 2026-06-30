import { describe, expect, test } from 'vitest'

import { mapAuthAccountSummary } from './service'

describe('mapAuthAccountSummary', () => {
  test('returns provider identity without token fields', () => {
    const summary = mapAuthAccountSummary({
      id: 'account-id',
      accountId: '12345',
      providerId: 'github',
      providerAccountName: 'Ronan',
      providerAccountEmail: 'ronan@example.com',
      providerAccountUsername: 'hunvreus',
      providerAccountImage: 'https://example.com/avatar.png',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
    })

    expect(summary).toEqual({
      id: 'account-id',
      accountId: '12345',
      providerId: 'github',
      managementUrl: null,
      providerAccountName: 'Ronan',
      providerAccountEmail: 'ronan@example.com',
      providerAccountUsername: 'hunvreus',
      providerAccountImage: 'https://example.com/avatar.png',
    })
    expect(summary).not.toHaveProperty('accessToken')
    expect(summary).not.toHaveProperty('refreshToken')
    expect(summary).not.toHaveProperty('idToken')
  })
})
