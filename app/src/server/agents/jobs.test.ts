import { describe, expect, test } from 'vitest'

import { buildAgentDeploymentEnvVars } from './jobs'

describe('agent deployment jobs', () => {
  test('adds devpush runtime env vars without overriding user env vars', () => {
    const envVars = buildAgentDeploymentEnvVars({
      deployment: {
        id: 'deployment-1',
        createdAt: new Date('2026-06-20T12:00:00.000Z'),
        gitBranch: 'main',
        gitSha: 'abc1234',
        repoFullName: 'acme/app',
        commitMeta: {
          authorName: 'Ada',
          message: 'Ship it',
        },
      },
      envVars: [
        { key: 'CUSTOM_VALUE', value: 'custom' },
        { key: 'DEVPUSH_GIT_REF', value: 'user-defined-ref' },
      ],
      snapshot: {
        version: 1,
        repo: {
          id: 123,
          fullName: 'acme/app',
          installationId: 456,
        },
        project: {
          id: 'project-1',
          teamId: 'team-1',
          name: 'app',
        },
        environment: {
          id: 'environment-1',
          name: 'Production',
          slug: 'production',
          branch: 'main',
          color: 'blue',
          defaultHost: 'app.devpush.local',
        },
        server: {
          id: 'server-1',
          name: 'Server',
          status: 'connected',
        },
        compose: {
          path: 'compose.yml',
          projectName: 'dp_project_environment',
          releaseCommand: null,
          releaseService: 'web',
          readinessPath: null,
          routes: [],
        },
      },
    })

    expect(envVars).toEqual(
      expect.arrayContaining([
        { key: 'CUSTOM_VALUE', value: 'custom' },
        { key: 'DEVPUSH', value: 'true' },
        { key: 'DEVPUSH_DOMAIN', value: 'app.devpush.local' },
        { key: 'DEVPUSH_URL', value: 'https://app.devpush.local' },
        { key: 'DEVPUSH_TEAM_ID', value: 'team-1' },
        { key: 'DEVPUSH_PROJECT_ID', value: 'project-1' },
        { key: 'DEVPUSH_ENVIRONMENT', value: 'production' },
        { key: 'DEVPUSH_DEPLOYMENT_ID', value: 'deployment-1' },
        {
          key: 'DEVPUSH_DEPLOYMENT_CREATED_AT',
          value: '2026-06-20T12:00:00.000Z',
        },
        { key: 'DEVPUSH_GIT_PROVIDER', value: 'github' },
        { key: 'DEVPUSH_GIT_REPO', value: 'acme/app' },
        { key: 'DEVPUSH_GIT_COMMIT_SHA', value: 'abc1234' },
        { key: 'DEVPUSH_GIT_COMMIT_AUTHOR', value: 'Ada' },
        { key: 'DEVPUSH_GIT_COMMIT_MESSAGE', value: 'Ship it' },
        { key: 'DEVPUSH_GIT_REPO_OWNER', value: 'acme' },
        { key: 'DEVPUSH_GIT_REPO_NAME', value: 'app' },
      ]),
    )
    expect(envVars.filter((envVar) => envVar.key === 'DEVPUSH_GIT_REF')).toEqual([
      { key: 'DEVPUSH_GIT_REF', value: 'user-defined-ref' },
    ])
  })
})
