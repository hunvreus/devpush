import { describe, expect, test } from 'vitest'

import {
  createComposeRuntimeConfig,
  parseProjectRuntimeConfig,
} from './project-runtime-config'

describe('project runtime config', () => {
  test('parses the Compose discriminator and settings as one object', () => {
    const config = createComposeRuntimeConfig({
      path: 'deploy/compose.yml',
      deployCommand: 'bash ./deploy.sh',
    })

    expect(parseProjectRuntimeConfig(config)).toEqual(config)
  })

  test('rejects unsupported runtime kinds', () => {
    expect(parseProjectRuntimeConfig({ type: 'dockerfile' })).toBeNull()
  })

  test('accepts an independent rollback override', () => {
    const config = createComposeRuntimeConfig({
      rollbackCommand: 'bash ./rollback.sh',
    })

    expect(parseProjectRuntimeConfig(config)).toEqual(config)
  })

  test('rejects oversized lifecycle commands', () => {
    const config = createComposeRuntimeConfig({
      deployCommand: 'x'.repeat(16 * 1024 + 1),
    })

    expect(parseProjectRuntimeConfig(config)).toBeNull()
  })

  test.each([
    '../compose.yml',
    'deploy/../../compose.yml',
    '/etc/compose.yml',
    './compose.yml',
    'deploy\\compose.yml',
    'deploy//compose.yml',
  ])('rejects Compose paths outside the repository contract: %s', (path) => {
    const config = createComposeRuntimeConfig({ path })

    expect(parseProjectRuntimeConfig(config)).toBeNull()
  })
})
