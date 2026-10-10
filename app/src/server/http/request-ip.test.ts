import { describe, expect, test } from 'vitest'

import { getRequestPublicAddress } from './request-ip'

const headers = {
  'cf-connecting-ip': '203.0.113.1',
  'x-forwarded-for': '203.0.113.2, 192.0.2.1',
  'x-real-ip': '203.0.113.3',
}

describe('getRequestPublicAddress', () => {
  test('trusts only the Cloudflare address in the Cloudflare runtime', () => {
    const request = new Request('https://devpush.example', { headers })

    expect(
      getRequestPublicAddress(request, { cloudflare: true, proxy: false }),
    ).toBe('203.0.113.1')
  })

  test('ignores client-supplied forwarding headers by default', () => {
    const request = new Request('https://devpush.example', { headers })

    expect(
      getRequestPublicAddress(request, { cloudflare: false, proxy: false }),
    ).toBeNull()
  })

  test('uses the direct peer address supplied by the server runtime', () => {
    const request = new Request('https://devpush.example', { headers })
    Object.defineProperty(request, 'ip', { value: '192.0.2.44' })

    expect(
      getRequestPublicAddress(request, { cloudflare: false, proxy: false }),
    ).toBe('192.0.2.44')
  })

  test('uses headers from an explicitly trusted reverse proxy', () => {
    const request = new Request('https://devpush.example', { headers })

    expect(
      getRequestPublicAddress(request, { cloudflare: false, proxy: true }),
    ).toBe('203.0.113.3')
  })
})
