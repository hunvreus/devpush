import { describe, expect, test } from 'vitest'

import { encryptProjectEnvVars, readProjectEnvVars } from './project-env-vars'

describe('project environment variable storage', () => {
  test('round-trips encrypted values without retaining plaintext JSON', () => {
    const variables = [
      { key: 'DATABASE_URL', value: 'postgres://secret', environment: '' },
      { key: 'API_KEY', value: 'private-value', environment: 'production' },
    ]
    const encrypted = encryptProjectEnvVars(variables)

    expect(encrypted).not.toContain('postgres://secret')
    expect(encrypted).not.toContain('private-value')
    expect(readProjectEnvVars({ envVarsEncrypted: encrypted })).toEqual(
      variables,
    )
  })

  test('returns no values when a project has none configured', () => {
    expect(readProjectEnvVars({ envVarsEncrypted: null })).toEqual([])
  })
})
