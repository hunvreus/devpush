import { describe, expect, test } from 'vitest'

import {
  createComposeRuntimeConfig,
  parseProjectRuntimeConfig,
  projectRuntimeConfigSchema,
} from './runtime-config'

describe('project runtime config', () => {
  test('parses the Compose discriminator and settings as one object', () => {
    const config = createComposeRuntimeConfig({
      path: 'deploy/compose.yml',
      strategy: 'command',
      deployCommand: 'bash ./deploy.sh',
    })

    expect(parseProjectRuntimeConfig(config)).toEqual(config)
  })

  test('rejects unsupported runtime kinds', () => {
    expect(parseProjectRuntimeConfig({ type: 'dockerfile' })).toBeNull()
  })

  test('requires a deploy command for command strategy', () => {
    const result = projectRuntimeConfigSchema.safeParse(
      createComposeRuntimeConfig({ strategy: 'command' }),
    )

    expect(result.success).toBe(false)
  })
})
