import { describe, expect, test } from 'vitest'

import {
  getEffectiveProjectRoutes,
  isEnvFilePaste,
  parseEnvFile,
} from './project-settings-utils'

describe('project settings helpers', () => {
  test('overrides shared routes by path for one environment', () => {
    const shared = {
      path: '/api',
      service: 'api',
      port: 3000,
      stripPrefix: false,
    }
    const staging = {
      ...shared,
      environmentId: 'staging',
      service: 'staging-api',
    }

    expect(getEffectiveProjectRoutes([shared, staging], 'staging')).toEqual([
      staging,
    ])
    expect(getEffectiveProjectRoutes([shared, staging], 'production')).toEqual([
      shared,
    ])
  })

  test('parses comments, whitespace, and quoted values from env files', () => {
    expect(
      parseEnvFile("# comment\n API_URL = 'https://example.com'\nEMPTY=\n"),
    ).toEqual([
      { key: 'API_URL', value: 'https://example.com' },
      { key: 'EMPTY', value: '' },
    ])
  })

  test('only recognizes complete env-file pastes', () => {
    expect(isEnvFilePaste('FOO=bar\nEMPTY=')).toBe(true)
    expect(isEnvFilePaste('not an env file')).toBe(false)
  })
})
