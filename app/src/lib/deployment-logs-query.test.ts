import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { deploymentLogsQueryOptions } from './deployment-logs-query'
import { getDeploymentLogs } from '#devpush/server/projects/functions'

vi.mock('#devpush/server/projects/functions', () => ({
  getDeploymentLogs: vi.fn(),
}))
beforeEach(() => vi.mocked(getDeploymentLogs).mockReset())

test('completion retains the running output when the final fetch fails', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const params = { teamSlug: 't', projectName: 'p', deploymentId: 'd' }
  const lines = [
    {
      content: 'Building',
      deploymentId: 'd',
      stream: 'deploy',
      seq: 1,
      createdAt: '2026-10-05T00:00:00Z',
    },
  ]
  client.setQueryData(
    deploymentLogsQueryOptions({ ...params, completed: false }).queryKey,
    lines,
  )
  vi.mocked(getDeploymentLogs).mockRejectedValueOnce(
    new TypeError('Failed to fetch'),
  )
  const observer = new QueryObserver(client, {
    ...deploymentLogsQueryOptions({
      ...params,
      completed: true,
      queryClient: client,
    }),
    retry: false,
  })
  expect(observer.getCurrentResult().data).toEqual(lines)
  const unsubscribe = observer.subscribe(() => {})
  const result = await observer.refetch()
  expect(result.isError).toBe(true)
  expect(result.data).toEqual(lines)
  expect(result.isPending).toBe(false)
  const other = deploymentLogsQueryOptions({
    ...params,
    deploymentId: 'other',
    completed: true,
    queryClient: client,
  })
  expect(other.initialData).toBeUndefined()
  unsubscribe()
  client.clear()
})

test('a transient final-log request failure retries and recovers', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const logs = [
    {
      content: 'Completed',
      deploymentId: 'd',
      stream: 'deploy',
      seq: 1,
      createdAt: '2026-10-08T00:00:00Z',
    },
  ]
  vi.mocked(getDeploymentLogs)
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(logs)
  const result = await client.fetchQuery({
    ...deploymentLogsQueryOptions({
      teamSlug: 't',
      projectName: 'p',
      deploymentId: 'd',
      completed: true,
    }),
    retryDelay: 0,
  })
  expect(result).toEqual(logs)
  expect(getDeploymentLogs).toHaveBeenCalledTimes(2)
  client.clear()
})

test('an expired session redirects without retrying the log request', async () => {
  const client = new QueryClient()
  vi.mocked(getDeploymentLogs).mockResolvedValueOnce(null)
  await expect(
    client.fetchQuery(
      deploymentLogsQueryOptions({
        teamSlug: 't',
        projectName: 'p',
        deploymentId: 'd',
        completed: true,
      }),
    ),
  ).rejects.toMatchObject({ options: { to: '/auth/login' } })
  expect(getDeploymentLogs).toHaveBeenCalledOnce()
  client.clear()
})

test('completion fetches final output even when a running snapshot is fresh', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  })
  const params = { teamSlug: 't', projectName: 'p', deploymentId: 'd' }
  const running = deploymentLogsQueryOptions({ ...params, completed: false })
  const complete = deploymentLogsQueryOptions({ ...params, completed: true })
  expect(complete.refetchOnWindowFocus).toBe(false)
  expect(complete.refetchOnReconnect).toBe(false)
  client.setQueryData(running.queryKey, [
    {
      content: 'Building',
      deploymentId: 'd',
      stream: 'stdout',
      seq: 1,
      createdAt: '2026-10-05T00:00:00Z',
    },
  ])
  vi.mocked(getDeploymentLogs).mockResolvedValue([
    {
      content: 'Finished',
      deploymentId: 'd',
      stream: 'stdout',
      seq: 2,
      createdAt: '2026-10-05T00:00:01Z',
    },
  ])
  const final = await client.fetchQuery(complete)
  expect(final.at(-1)?.content).toBe('Finished')
  expect(getDeploymentLogs).toHaveBeenCalledOnce()
  expect(
    typeof running.refetchInterval === 'function' &&
      running.refetchInterval(
        {} as Parameters<
          Exclude<typeof running.refetchInterval, number | false | undefined>
        >[0],
      ),
  ).toBe(2_000)
  expect(
    typeof complete.refetchInterval === 'function' &&
      complete.refetchInterval(
        {} as Parameters<
          Exclude<typeof complete.refetchInterval, number | false | undefined>
        >[0],
      ),
  ).toBe(false)
  client.clear()
})

test('a late running response cannot overwrite the completed snapshot', async () => {
  const client = new QueryClient()
  const params = { teamSlug: 't', projectName: 'p', deploymentId: 'd' }
  const running = deploymentLogsQueryOptions({ ...params, completed: false })
  const complete = deploymentLogsQueryOptions({ ...params, completed: true })
  vi.mocked(getDeploymentLogs).mockResolvedValue([
    {
      content: 'Finished',
      deploymentId: 'd',
      stream: 'stdout',
      seq: 2,
      createdAt: '2026-10-05T00:00:01Z',
    },
  ])
  let resolve!: (value: []) => void
  vi.mocked(getDeploymentLogs).mockImplementationOnce(
    () =>
      new Promise<[]>((done) => {
        resolve = done
      }),
  )
  const old = client.fetchQuery(running)
  const final = await client.fetchQuery(complete)
  resolve([])
  await old
  expect(final.at(-1)?.content).toBe('Finished')
  expect(client.getQueryData(complete.queryKey)).toEqual(final)
  client.clear()
})
