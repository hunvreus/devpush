import { describe, expect, test } from 'vitest'
import {
  apiKeyExpirationOptions,
  createApiKeySchema,
  scopesForApiPreset,
} from './api-key-schema'

describe('API key grants', () => {
  test('read-only keys do not grant logs or writes by default', () => {
    expect(scopesForApiPreset('read', 'owner')).toEqual([
      'projects:read',
      'servers:read',
      'deployments:read',
      'backups:read',
    ])
    expect(scopesForApiPreset('read', 'member', true)).toContain('logs:read')
  })

  test('management scopes never exceed the issuing membership role', () => {
    expect(scopesForApiPreset('manage', 'member')).toContain('secrets:write')
    expect(scopesForApiPreset('manage', 'member')).not.toContain(
      'servers:write',
    )
    expect(scopesForApiPreset('manage', 'member')).not.toContain(
      'backups:restore',
    )
    expect(scopesForApiPreset('manage', 'member')).not.toContain(
      'backups:write',
    )
    expect(scopesForApiPreset('manage', 'admin')).toContain(
      'projects:host-commands',
    )
  })

  test('creation has bounded names, projects and defaults to 30-day expiration', () => {
    expect(
      createApiKeySchema.parse({ name: ' CI ', teamId: 'team' }),
    ).toMatchObject({
      name: 'CI',
      preset: 'read',
      includeLogs: false,
      expiresInDays: 30,
      projectIds: null,
    })
    for (const extra of [
      { expiresInDays: 0 },
      { expiresInDays: 366 },
      { expiresInDays: 1.5 },
      { expiresInDays: 'never' },
      { projectIds: [] },
      { projectIds: ['one', 'one'] },
    ]) {
      expect(
        createApiKeySchema.safeParse({ name: 'CI', teamId: 'team', ...extra })
          .success,
      ).toBe(false)
    }
  })

  test('expiry accepts each shared option, null for never and finite values up to one year', () => {
    for (const option of apiKeyExpirationOptions) {
      expect(
        createApiKeySchema.parse({
          name: 'CI',
          teamId: 'team',
          expiresInDays: option.days,
        }).expiresInDays,
      ).toBe(option.days)
    }
    expect(
      createApiKeySchema.parse({
        name: 'Custom expiry',
        teamId: 'team',
        expiresInDays: 60,
      }).expiresInDays,
    ).toBe(60)
  })
})
