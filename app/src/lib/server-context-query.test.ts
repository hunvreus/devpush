import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'

import { getTeamServerContext } from '@/server/auth/context'
import { serverContextQueryOptions } from './server-context-query'
import { teamSectionQueryOptions } from './team-context-query'

vi.mock('@/server/auth/context', () => ({
  getTeamServerContext: vi.fn(),
  getTeamSectionContext: vi.fn(),
  getTeamShellContext: vi.fn(),
}))

const params = { teamSlug: 'team', serverId: 'server' }

test('refetches server context through enrollment, connection and disconnection', async () => {
  const client = new QueryClient()
  const getContext = vi.mocked(getTeamServerContext)
  const options = serverContextQueryOptions(params)
  try {
    for (const status of ['pending', 'connected', 'disconnected']) {
      getContext.mockResolvedValueOnce({ server: { status } } as Awaited<
        ReturnType<typeof getTeamServerContext>
      >)
      await client.invalidateQueries({ queryKey: options.queryKey })
      const result = await client.fetchQuery(options)
      expect(result.server.status).toBe(status)
    }
    expect(getContext).toHaveBeenLastCalledWith({ data: params })
  } finally {
    client.clear()
  }
})

test('list and details poll continuously, pause background polling and refresh on focus', () => {
  const detail = serverContextQueryOptions(params)
  const list = teamSectionQueryOptions({ teamSlug: 'team', section: 'servers' })
  expect(
    typeof detail.refetchInterval === 'function' &&
      detail.refetchInterval(
        {} as Parameters<
          Exclude<typeof detail.refetchInterval, number | false | undefined>
        >[0],
      ),
  ).toBe(5_000)
  expect(detail.refetchIntervalInBackground).toBe(false)
  expect(detail.refetchOnWindowFocus).toBe('always')
  expect(list.refetchIntervalInBackground).toBe(false)
  expect(list.refetchOnWindowFocus).toBe('always')
  if (typeof list.refetchInterval !== 'function')
    throw Error('Missing polling policy')
  expect(
    list.refetchInterval({} as Parameters<typeof list.refetchInterval>[0]),
  ).toBe(5_000)
})
