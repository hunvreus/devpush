import { describe, expect, test } from 'vitest'

import {
  decryptDeploymentEnvVars,
  encryptDeploymentEnvVars,
  parseDeploymentConfig,
} from './deployment-config'

describe('deployment snapshots', () => {
  test('encrypts environment variables instead of storing cleartext JSON', () => {
    const encrypted = encryptDeploymentEnvVars([
      { key: 'DATABASE_URL', value: 'postgres://secret@example/db' },
    ])

    expect(encrypted).not.toContain('DATABASE_URL')
    expect(encrypted).not.toContain('postgres://secret@example/db')
    expect(decryptDeploymentEnvVars(encrypted)).toEqual([
      { key: 'DATABASE_URL', value: 'postgres://secret@example/db' },
    ])
  })

  test('parses a valid deployment config', () => {
    const config = parseDeploymentConfig({
      version: 2,
      composePath: 'compose.yml',
      releaseCommand: null,
      releaseService: 'web',
      readinessPath: null,
      routes: [
        {
          host: 'project.devpush.app',
          service: 'web',
          port: 3000,
          path: '/',
          https: true,
        },
      ],
    })

    expect(config?.routes).toEqual([
      {
        host: 'project.devpush.app',
        service: 'web',
        port: 3000,
        path: '/',
        https: true,
        stripPrefix: false,
      },
    ])
  })
})
