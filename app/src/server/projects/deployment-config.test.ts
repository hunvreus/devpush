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
      schemaVersion: 1,
      runtime: {
        type: 'compose',
        path: 'compose.yml',
        releaseCommand: null,
        releaseService: 'web',
        readinessPath: null,
        deployCommand: null,
        rollbackCommand: null,
        timeoutSeconds: 1800,
      },
      routes: [
        {
          host: 'project.devpush.app',
          service: 'web',
          port: 3000,
          path: '/',
          https: true,
          stripPrefix: false,
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
    expect(config?.runtime).toEqual({
      type: 'compose',
      path: 'compose.yml',
      releaseCommand: null,
      releaseService: 'web',
      readinessPath: null,
      deployCommand: null,
      rollbackCommand: null,
      timeoutSeconds: 1800,
    })
  })

  test('rejects unsupported deployment config schemas', () => {
    const config = parseDeploymentConfig({
      runtime: {
        type: 'compose',
        path: 'compose.yml',
        releaseCommand: null,
        releaseService: null,
        readinessPath: null,
        deployCommand: null,
        rollbackCommand: null,
        timeoutSeconds: 1800,
      },
      routes: [],
    })

    expect(config).toBeNull()
  })
})
