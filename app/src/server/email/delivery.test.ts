import { afterEach, expect, test, vi } from 'vitest'
import { sendEmail } from './service'

vi.mock('#devpush/server/config', () => ({
  config: {
    EMAIL_FROM: 'devpush <sender@example.com>',
    RESEND_API_KEY: 'private-key',
    BETTER_AUTH_URL: 'https://example.com',
  },
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const payload = {
  to: 'recipient@example.com',
  subject: 'Notice',
  text: 'Notice',
  html: '<p>Notice</p>',
}
test('delivery preserves idempotency and bounds the provider request', async () => {
  const deadline = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'accepted' }))
  vi.stubGlobal('fetch', fetch)
  await sendEmail(payload, 'stable-delivery-id')
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('https://api.resend.com/emails')
  expect(new Headers(options.headers).get('Idempotency-Key')).toBe(
    'stable-delivery-id',
  )
  expect(JSON.parse(String(options.body))).toEqual({
    ...payload,
    from: 'devpush <sender@example.com>',
  })
  expect(options.signal).toBe(deadline.signal)
  expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000)
})
test('rejected provider payloads cannot leak secrets through exceptions or logs', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { message: 'private-key recipient@example.com' },
          { status: 401 },
        ),
      ),
  )
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(sendEmail(payload)).rejects.toThrow('Unable to deliver email.')
  expect(JSON.stringify(warning.mock.calls)).not.toContain('private-key')
  expect(warning).toHaveBeenCalledWith('Email provider rejected delivery.', {
    status: 401,
  })
})
test('timed out delivery rejects for the existing outbox retry path', async () => {
  const deadline = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  vi.stubGlobal(
    'fetch',
    (_url: string, options: RequestInit) =>
      new Promise((_resolve, reject) =>
        options.signal?.addEventListener(
          'abort',
          () => reject(new Error('private upstream message')),
          { once: true },
        ),
      ),
  )
  const pending = sendEmail(payload)
  const failure = expect(pending).rejects.toThrow('Unable to deliver email.')
  deadline.abort()
  await failure
})

test('a persisted sender overrides changed sender configuration on retries', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'accepted' }))
  vi.stubGlobal('fetch', fetch)
  await sendEmail(
    { ...payload, from: 'Original <original@example.test>' },
    'stable-snapshot',
  )
  expect(JSON.parse(String(fetch.mock.calls[0]![1].body)).from).toBe(
    'Original <original@example.test>',
  )
})
