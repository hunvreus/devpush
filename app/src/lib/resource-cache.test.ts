import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { invalidateResourceQueries } from './resource-cache'

test('mutations invalidate all affected snapshots, preserve other teams, and refresh on next load', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  })
  const keys = [
    ['team-context', 'a', 'shell'],
    ['server-context', 'a', 'server'],
    ['server-metrics', 'a', 'server'],
    ['manual-deploy-options', 'a', 'project', 'environment'],
    ['operation-logs', 'a', 'restore', 'job'],
    ['project-context', 'a', 'p', 'shell'],
    ['deployment-context', 'a', 'p', 'd'],
    ['project-logs', 'a', 'p'],
  ]
  for (const key of [...keys, ['team-context', 'b', 'shell']])
    client.setQueryData(key, 'old')
  await invalidateResourceQueries(client, 'a')
  for (const key of keys)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  expect(
    client.getQueryState(['team-context', 'b', 'shell'])?.isInvalidated,
  ).toBe(false)
  const queryFn = vi.fn().mockResolvedValue('new')
  expect(await client.fetchQuery({ queryKey: keys[0]!, queryFn })).toBe('new')
  expect(await client.fetchQuery({ queryKey: keys[0]!, queryFn })).toBe('new')
  expect(queryFn).toHaveBeenCalledOnce()
  client.clear()
})

test('a pre-mutation request cannot repopulate the cache after invalidation', async () => {
  const client = new QueryClient()
  const key = ['project-context', 'a', 'p', 'shell']
  let resolve!: (value: string) => void
  const old = client
    .fetchQuery({
      queryKey: key,
      queryFn: () =>
        new Promise<string>((done) => {
          resolve = done
        }),
    })
    .catch(() => undefined)
  await invalidateResourceQueries(client, 'a')
  client.setQueryData(key, 'new')
  resolve('old')
  await old
  expect(client.getQueryData(key)).toBe('new')
  client.clear()
})
