import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'

import {
  getTeamServerContext,
  getTeamServerMetricHistory,
} from '#devpush/server/servers/functions'
import {
  serverContextQueryOptions,
  serverMetricHistoryQueryOptions,
} from './server-context-query'
import { teamSectionQueryOptions } from './team-context-query'

vi.mock('#devpush/server/servers/functions', () => ({
  getTeamServerContext: vi.fn(),
  getTeamServerMetricHistory: vi.fn(),
}))
vi.mock('#devpush/server/teams/functions', () => ({
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

test('history has an independent cache and avoids refetching fresh points', async () => {
  const client = new QueryClient()
  const options = serverMetricHistoryQueryOptions(params)
  const history = {
    points: [],
    window: {
      startedAt: '2026-10-12T00:00:00Z',
      endedAt: '2026-10-13T00:00:00Z',
    },
  }
  vi.mocked(getTeamServerMetricHistory).mockResolvedValue(history)
  try {
    expect(await client.fetchQuery(options)).toEqual(history)
    expect(await client.fetchQuery(options)).toEqual(history)
    expect(getTeamServerMetricHistory).toHaveBeenCalledTimes(1)
    expect(options.queryKey).toEqual(['server-metrics', 'team', 'server'])
    if (typeof options.refetchInterval !== 'function')
      throw Error('Missing history polling policy')
    expect(
      options.refetchInterval(
        {} as Parameters<typeof options.refetchInterval>[0],
      ),
    ).toBe(30_000)
  } finally {
    client.clear()
  }
})
