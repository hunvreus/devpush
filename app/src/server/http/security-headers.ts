const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https: wss:",
  "font-src 'self' data:",
  "form-action 'self' https://github.com https://accounts.google.com",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  'upgrade-insecure-requests',
].join('; ')

export function withSecurityHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers)
  headers.set('Content-Security-Policy', contentSecurityPolicy)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')

  if (new URL(request.url).protocol === 'https:') {
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    )
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}
