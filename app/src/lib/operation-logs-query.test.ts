import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { operationLogsQueryOptions } from './operation-logs-query'

afterEach(() => vi.unstubAllGlobals())
test('polls only new UTF-8 bytes, caches reopening, and preserves output after a failed read', async () => {
  const client = new QueryClient()
  const content = 'Starting 🐻\n'
  const offset = new TextEncoder().encode(content).length
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ content, nextOffset: offset }))
    .mockResolvedValueOnce(
      Response.json({ content: 'Done', nextOffset: offset + 4 }),
    )
    .mockResolvedValueOnce(new Response('', { status: 500 }))
  vi.stubGlobal('fetch', fetch)
  const options = operationLogsQueryOptions(
    { teamSlug: 'team', type: 'restore', id: 'job' },
    client,
  )
  try {
    expect((await client.fetchQuery(options)).content).toBe(content)
    expect((await client.fetchQuery(options)).content).toBe(content)
    expect(fetch).toHaveBeenCalledTimes(1)
    await client.invalidateQueries({ queryKey: options.queryKey })
    expect((await client.fetchQuery(options)).content).toBe(content + 'Done')
    expect(fetch.mock.calls[1]![0]).toBe(
      `/api/agents/job-logs?type=restore&id=job&offset=${offset}`,
    )
    await client.invalidateQueries({ queryKey: options.queryKey })
    await expect(client.fetchQuery(options)).rejects.toThrow(
      'Unable to load logs',
    )
    expect(client.getQueryData(options.queryKey)).toEqual({
      content: content + 'Done',
      nextOffset: offset + 4,
    })
  } finally {
    client.clear()
  }
})

test('restarts an expired cursor without losing the display on a failed reset', async () => {
  const client = new QueryClient()
  const options = operationLogsQueryOptions(
    { teamSlug: 'team', type: 'backup', id: 'job' },
    client,
  )
  client.setQueryData(options.queryKey, {
    content: 'Old output',
    nextOffset: 100,
  })
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 409 }))
    .mockResolvedValueOnce(Response.json({ content: 'New', nextOffset: 103 }))
  vi.stubGlobal('fetch', fetch)
  try {
    await client.invalidateQueries({ queryKey: options.queryKey })
    expect(await client.fetchQuery(options)).toEqual({
      content: 'New',
      nextOffset: 103,
    })
    expect(fetch.mock.calls[1]![0]).toContain('offset=0')
    fetch
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
    await client.invalidateQueries({ queryKey: options.queryKey })
    await expect(client.fetchQuery(options)).rejects.toThrow(
      'Unable to load logs',
    )
    expect(client.getQueryData(options.queryKey)).toEqual({
      content: 'New',
      nextOffset: 103,
    })
  } finally {
    client.clear()
  }
})
