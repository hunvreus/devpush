import { describe, expect, test } from 'vitest'

import { withSecurityHeaders } from './security-headers'

describe('security headers', () => {
  test('adds browser protections and HSTS over HTTPS', () => {
    const response = withSecurityHeaders(
      new Response('ok'),
      new Request('https://devpush.example'),
    )

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('strict-transport-security')).toContain(
      'max-age=31536000',
    )
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    )
  })

  test('does not send HSTS over HTTP', () => {
    const response = withSecurityHeaders(
      new Response('ok'),
      new Request('http://localhost:7429'),
    )

    expect(response.headers.has('strict-transport-security')).toBe(false)
  })
})
