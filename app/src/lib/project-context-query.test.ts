import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  projectContextQueryOptions,
  invalidateProjectLogs,
} from './project-context-query'

describe('project query invalidation', () => {
  it('invalidates only the selected project log query', async () => {
    const queryClient = new QueryClient()
    const params = {
      branch: 'main',
      date: '24h',
      deploymentId: null,
      environmentId: 'production',
      keyword: 'ready',
      projectName: 'devpush',
      teamSlug: 'acme',
    }
    const key = [
      'project-logs',
      params.teamSlug,
      params.projectName,
      params.branch,
      params.date,
      params.deploymentId,
      params.environmentId,
      params.keyword,
    ]
    queryClient.setQueryData(key, { logs: [] })

    await invalidateProjectLogs(queryClient, params)

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })
})

it('refreshes stale shared project data when refreshing a section', async () => {
  const { projectShellQueryOptions } = await import('./project-context-query')
  const { projectContext } = await import('#devpush/test/project-context')
  const { getProject, getProjectSection } =
    await import('#devpush/server/projects/functions')
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  })
  const params = { teamSlug: 'team', projectName: 'project' }
  queryClient.setQueryData(
    projectShellQueryOptions(params).queryKey,
    { ...projectContext, servers: [] },
    { updatedAt: Date.now() - 60_000 },
  )
  vi.mocked(getProject).mockResolvedValue(projectContext)
  vi.mocked(getProjectSection).mockResolvedValue({
    scope: 'deployments',
    projectId: projectContext.project.id,
    deployments: [],
  })
  const result = await queryClient.fetchQuery(
    projectContextQueryOptions(
      { ...params, scope: 'deployments' },
      queryClient,
    ),
  )
  expect(getProject).toHaveBeenCalledOnce()
  expect(result.servers).toEqual(projectContext.servers)
  queryClient.clear()
})

vi.mock('#devpush/server/projects/functions', () => ({
  getProject: vi.fn(),
  getProjectSection: vi.fn(),
  getProjectLogs: vi.fn(),
  getDeployment: vi.fn(),
}))

it('runtime logs keep polling after deployments finish', async () => {
  const { projectLogsQueryOptions } = await import('./project-context-query')
  const client = new QueryClient()
  const options = projectLogsQueryOptions(
    { teamSlug: 't', projectName: 'p' },
    client,
  )
  expect(
    typeof options.refetchInterval === 'function' &&
      options.refetchInterval(
        {} as Parameters<
          Exclude<typeof options.refetchInterval, number | false | undefined>
        >[0],
      ),
  ).toBe(2_000)
  client.clear()
})

it('completed deployment selectors keep discovering new deployments without WebSocket', async () => {
  const { pluginContextQueryOptions } =
    await import('./project-context-query')
  const { setWorkspaceConnected } = await import('./workspace-updates')
  const client = new QueryClient()
  const options = pluginContextQueryOptions(
    { teamSlug: 'selector-test', projectName: 'p', deploymentId: 'd' },
    client,
  )
  if (typeof options.refetchInterval !== 'function')
    throw new Error('Expected adaptive polling')
  const query = {
    state: { data: { deployment: { status: 'succeeded' } } },
  } as Parameters<typeof options.refetchInterval>[0]
  expect(options.refetchInterval(query)).toBe(15_000)
  setWorkspaceConnected('selector-test', true)
  try {
    expect(options.refetchInterval(query)).toBe(60_000)
  } finally {
    setWorkspaceConnected('selector-test', false)
    client.clear()
  }
})

it('backup failure alerts refresh during jobs and while idle without WebSocket', async () => {
  const { projectContext } = await import('#devpush/test/project-context')
  const client = new QueryClient()
  const options = projectContextQueryOptions(
    { teamSlug: 'backup-refresh', projectName: 'p', scope: 'backups' },
    client,
  )
  if (typeof options.refetchInterval !== 'function')
    throw new Error('Expected adaptive polling')
  const interval = options.refetchInterval
  const query = (status: 'running' | 'failed') =>
    ({
      state: {
        data: {
          ...projectContext,
          deployments: [],
          backupRuns: [
            {
              id: 'r',
              configId: 'b',
              localRecoveryAvailable: false,
              status,
              environmentId: 'e',
              environmentName: 'Production',
              environmentColor: 'lime',
              serverId: null,
              serverName: null,
              errorMessage: null,
              startedAt: null,
              finishedAt: null,
              createdAt: '2026-10-08',
              artifacts: [],
            },
          ],
        },
      },
    }) as unknown as Parameters<typeof interval>[0]
  expect(interval(query('running'))).toBe(2_000)
  expect(interval(query('failed'))).toBe(15_000)
  client.clear()
})

it.each(['queued', 'running', 'succeeded', 'failed'] as const)(
  'restore %s controls backup fallback polling',
  async (status) => {
    const { projectContext } = await import('#devpush/test/project-context')
    const client = new QueryClient()
    const options = projectContextQueryOptions(
      { teamSlug: 'restore-refresh', projectName: 'p', scope: 'backups' },
      client,
    )
    if (typeof options.refetchInterval !== 'function')
      throw new Error('Expected adaptive polling')
    const query = {
      state: {
        data: {
          ...projectContext,
          deployments: [],
          backupRuns: [],
          backupRestores: [
            {
              id: 'restore',
              backupRunId: 'run',
              environmentId: 'e',
              status,
              errorMessage: null,
              createdAt: '2026-10-09',
              startedAt: null,
              finishedAt: null,
            },
          ],
        },
      },
    } as unknown as Parameters<typeof options.refetchInterval>[0]
    expect(options.refetchInterval(query)).toBe(
      ['queued', 'running'].includes(status) ? 2000 : 15000,
    )
    client.clear()
  },
)
