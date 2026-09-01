import { createAuthClient } from 'better-auth/react'
import { emailOTPClient } from 'better-auth/client/plugins'

function getAuthBaseURL() {
  if (typeof window !== 'undefined') {
    return new URL('/api/auth', window.location.origin).toString()
  }

  return new URL(
    '/api/auth',
    process.env.BETTER_AUTH_URL ??
      process.env.DEVPUSH_BASE_URL ??
      'http://localhost:7429',
  ).toString()
}

export const authClient = createAuthClient({
  baseURL: getAuthBaseURL(),
  plugins: [emailOTPClient()],
})
