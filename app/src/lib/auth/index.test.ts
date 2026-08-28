import { describe, expect, test } from 'vitest'

import { auth } from './index'

describe('auth cookies', () => {
  test('uses an application-specific cookie namespace', () => {
    expect(auth.options.advanced.cookiePrefix).toBe('devpush')
  })

  test.each([
    ['/sign-up/email', 'EMAIL_PASSWORD_SIGN_UP_DISABLED'],
    ['/sign-in/email', 'EMAIL_PASSWORD_DISABLED'],
  ])('does not expose password endpoint %s', async (path, expectedCode) => {
    const response = await auth.handler(
      new Request(`https://devpush.test/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          name: 'Example User',
          password: 'not-a-real-password',
        }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: expectedCode,
    })
  })
})
