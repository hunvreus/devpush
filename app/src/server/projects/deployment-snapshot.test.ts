import { describe, expect, test } from 'vitest'

import {
  decryptDeploymentEnvVars,
  encryptDeploymentEnvVars,
  parseDeploymentConfigSnapshot,
} from './deployment-snapshot'

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

  test('parses a valid deployment config snapshot', () => {
    const snapshot = parseDeploymentConfigSnapshot({
      version: 1,
      repo: {
        id: 123,
        fullName: 'owner/repo',
        installationId: 456,
      },
      project: {
        id: 'project-id',
        slug: 'project',
        name: 'Project',
      },
      environment: {
        id: 'environment-id',
        name: 'Production',
        slug: 'production',
        branch: 'main',
        color: 'blue',
        defaultHost: 'project.devpush.app',
      },
      server: {
        id: 'server-id',
        name: 'Server',
        status: 'connected',
      },
      compose: {
        path: 'compose.yml',
        projectName: 'dp_project_production',
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
      },
    })

    expect(snapshot?.repo.fullName).toBe('owner/repo')
    expect(snapshot?.compose.routes).toEqual([
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
