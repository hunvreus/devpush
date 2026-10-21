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

  test('ignores spoofed alternate headers and the client-supplied XFF prefix', () => {
    const request = new Request('https://devpush.example', { headers })

    expect(
      getRequestPublicAddress(request, { cloudflare: false, proxy: true }),
    ).toBe('192.0.2.1')
  })

  test('trusts X-Real-IP only when that header is explicitly selected', () => {
    const request = new Request('https://devpush.example', { headers })
    expect(
      getRequestPublicAddress(request, {
        cloudflare: false,
        proxy: true,
        header: 'x-real-ip',
      }),
    ).toBe('203.0.113.3')
  })

  test('does not fall back to client-supplied headers when the selected header is absent', () => {
    const request = new Request('https://devpush.example', {
      headers: { 'x-real-ip': '203.0.113.99' },
    })
    expect(
      getRequestPublicAddress(request, {
        cloudflare: false,
        proxy: true,
        header: 'x-forwarded-for',
      }),
    ).toBeNull()
  })
})
