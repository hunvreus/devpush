import { expect, test } from 'vitest'
import { resolveProxyRequest } from './proxy-request'

const options = {
  trusted: true,
  origins: [
    'https://devpush.example',
    'https://auth.example',
    'https://mcp.example/mcp',
  ],
}
test('trusted proxy restores configured HTTPS origin, preserving path and query', () => {
  const request = new Request('http://app:3000/settings?tab=keys', {
    headers: {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'devpush.example',
    },
  })
  expect(resolveProxyRequest(request, options).url).toBe(
    'https://devpush.example/settings?tab=keys',
  )
  expect(resolveProxyRequest(request, { ...options, trusted: false })).toBe(
    request,
  )
})
test.each([
  'evil.example',
  'evil@devpush.example',
  'devpush.example/path',
  'devpush.example?query',
  'devpush.example#hash',
])('rejects unconfigured or malformed forwarded host: %s', (host) => {
  const request = new Request('http://app:3000/', {
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': host },
  })
  expect(resolveProxyRequest(request, options)).toBe(request)
})
test('uses the rightmost proxy hop and never broadens the configured origin set', () => {
  const request = new Request('http://app:3000/mcp', {
    headers: {
      'x-forwarded-proto': 'http, https',
      'x-forwarded-host': 'evil.example, mcp.example',
    },
  })
  expect(resolveProxyRequest(request, options).url).toBe(
    'https://mcp.example/mcp',
  )
})
test('preserves request body, headers and cancellation', async () => {
  const controller = new AbortController()
  const request = new Request('http://app:3000/api/v1/projects', {
    method: 'POST',
    body: '{"name":"project"}',
    signal: controller.signal,
    headers: {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'devpush.example',
      authorization: 'Bearer fixture',
    },
  })
  const resolved = resolveProxyRequest(request, options)
  expect(resolved.method).toBe('POST')
  expect(await resolved.text()).toBe('{"name":"project"}')
  expect(resolved.headers.get('authorization')).toBe('Bearer fixture')
  controller.abort()
  expect(resolved.signal.aborted).toBe(true)
})
