import { afterEach, expect, test, vi } from 'vitest'
import { fetchGitHub, readGitHubJson } from './http'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
test('all provider requests have a deadline while preserving caller cancellation and headers', async () => {
  const deadline = new AbortController()
  const caller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const fetch = vi.fn().mockResolvedValue(Response.json({}))
  vi.stubGlobal('fetch', fetch)
  await fetchGitHub('https://api.github.com/user', {
    headers: { Authorization: 'Bearer private' },
    signal: caller.signal,
  })
  const options = fetch.mock.calls[0]![1] as RequestInit
  expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000)
  expect(options.headers).toEqual({ Authorization: 'Bearer private' })
  caller.abort()
  expect(options.signal?.aborted).toBe(true)
})
test('a stalled provider request rejects when its deadline expires', async () => {
  const deadline = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  vi.stubGlobal(
    'fetch',
    (_url: string, options: RequestInit) =>
      new Promise((_resolve, reject) =>
        options.signal?.addEventListener(
          'abort',
          () => reject(options.signal?.reason),
          { once: true },
        ),
      ),
  )
  const pending = fetchGitHub('https://api.github.com/user')
  const failure = expect(pending).rejects.toThrow('provider timeout')
  deadline.abort(new Error('provider timeout'))
  await failure
})

test('provider JSON parsing stops oversized bodies and accepts bounded JSON', async () => {
  await expect(readGitHubJson(Response.json({ ok: true }))).resolves.toEqual({
    ok: true,
  })
  let cancelled = false
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
      cancel() {
        cancelled = true
      },
    }),
  )
  await expect(readGitHubJson(response)).rejects.toThrow('byte limit')
  expect(cancelled).toBe(true)
})
