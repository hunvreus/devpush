import { describe, expect, test } from 'vitest'
import { makeSignature } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { config } from '#devpush/server/config'
import { db } from '#devpush/server/db'
import { session, user } from '#devpush/server/db/schema'

import { auth } from './better-auth'

describe('auth cookies', () => {
  test('generic user updates cannot set an arbitrary avatar path even with a valid session', async () => {
    const id = crypto.randomUUID()
    const token = crypto.randomUUID()
    await db.insert(user).values({
      id,
      name: 'Avatar owner',
      username: `owner-${id}`,
      email: `${id}@example.com`,
      emailVerified: true,
    })
    await db.insert(session).values({
      id: crypto.randomUUID(),
      userId: id,
      token,
      expiresAt: new Date(Date.now() + 60_000),
    })
    try {
      const signature = await makeSignature(token, config.BETTER_AUTH_SECRET)
      const response = await auth.handler(
        new Request(`${config.BETTER_AUTH_URL}/api/auth/update-user`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: config.BETTER_AUTH_URL,
            cookie: `devpush.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
          },
          body: JSON.stringify({
            name: 'X',
            image: '/uploads/avatars/team_victim.png',
          }),
        }),
      )
      expect(response.status).toBe(404)
      expect(
        (await db.select().from(user).where(eq(user.id, id)))[0]?.image,
      ).toBeNull()
    } finally {
      await db.delete(user).where(eq(user.id, id))
    }
  })
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
