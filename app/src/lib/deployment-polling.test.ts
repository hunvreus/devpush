// @vitest-environment jsdom
import { QueryClient, QueryObserver, focusManager } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { projectContextQueryOptions } from './project-context-query'
import { teamSectionQueryOptions } from './team-context-query'
import { projectContext } from '#devpush/test/project-context'
import type { DeploymentSummary } from '#devpush/server/projects/types'

const deployment: DeploymentSummary = {
  id: 'd',
  status: 'running',
  phase: 'building',
  trigger: 'user',
  gitSha: 'abc',
  gitBranch: 'main',
  githubRepo: 'a/b',
  deploymentHost: null,
  isServing: false,
  deploymentRouteHttps: false,
  commitMessage: null,
  errorMessage: null,
  createdAt: '2026-10-05T00:00:00Z',
  startedAt: null,
  finishedAt: null,
  environmentName: 'Production',
  environmentSlug: 'production',
  environmentColor: 'green',
  serverId: 's',
  serverName: 'Server',
  serverStatus: 'connected',
  projectName: 'project',
  projectColor: 'blue',
}

const mocks = vi.hoisted(() => ({ section: vi.fn(), team: vi.fn() }))
vi.mock('#devpush/server/projects/functions', () => ({
  getProject: vi.fn(),
  getProjectSection: mocks.section,
}))
vi.mock('#devpush/server/teams/functions', () => ({
  getTeamShellContext: vi.fn(),
  getTeamSectionContext: mocks.team,
}))
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  focusManager.setFocused(undefined)
})

test.each(['project', 'team'] as const)(
  '%s deployment polling slows on completion and leaves unrelated data alone',
  async (kind) => {
    vi.useFakeTimers()
    focusManager.setFocused(true)
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    })
    const projectParams = {
      teamSlug: 'team',
      projectName: 'project',
      scope: 'deployments' as const,
    }
    const settingsKey = ['project-context', 'team', 'project', 'settings']
    client.setQueryData(settingsKey, projectContext)
    client.setQueryData(
      ['project-context', 'team', 'project', 'shell'],
      projectContext,
    )
    const options =
      kind === 'project'
        ? projectContextQueryOptions(projectParams, client)
        : teamSectionQueryOptions({ teamSlug: 'team', section: 'overview' })
    const fetch = kind === 'project' ? mocks.section : mocks.team
    const context =
      kind === 'project'
        ? { ...projectContext, deployments: [deployment] }
        : { section: 'overview' as const, deployments: [deployment] }
    client.setQueryData(options.queryKey, context)
    fetch.mockResolvedValue(
      kind === 'project'
        ? {
            scope: 'deployments',
            projectId: projectContext.project.id,
            deployments: [{ ...deployment, status: 'succeeded' }],
          }
        : {
            section: 'overview',
            deployments: [{ ...deployment, status: 'succeeded' }],
          },
    )
    const observer =
      kind === 'project'
        ? new QueryObserver(
            client,
            projectContextQueryOptions(projectParams, client),
          )
        : new QueryObserver(
            client,
            teamSectionQueryOptions({ teamSlug: 'team', section: 'overview' }),
          )
    const unsubscribe = observer.subscribe(() => {})
    focusManager.setFocused(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetch).not.toHaveBeenCalled()
    focusManager.setFocused(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(client.getQueryState(settingsKey)?.isInvalidated).toBe(false)
    expect(client.getQueryData(settingsKey)).toBe(projectContext)
    unsubscribe()
    client.clear()
  },
)
