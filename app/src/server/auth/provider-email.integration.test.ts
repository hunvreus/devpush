import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { SignJWT } from 'jose'
import { db, closeDb } from '@/server/db'
import { verification } from '@/server/db/schema'
import { auth, getGitHubUserInfo, getGoogleUserInfo } from './better-auth'
import { accountSettingsSchema } from '@/lib/account-settings-schema'

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete(verification)
})
afterAll(closeDb)

test.each(['A', 'x@example.com'])(
  'generated usernames from %s satisfy account settings validation',
  async (name) => {
    const result = await auth.options.databaseHooks.user.create.before({
      id: crypto.randomUUID(),
      name,
      email: 'a@example.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(
      accountSettingsSchema.safeParse({
        settingsVersion: 1,
        name,
        username: result.data.username,
      }).success,
    ).toBe(true)
  },
)

function github(
  emails: Array<{ email: string; verified: boolean; primary: boolean }>,
  profileEmail: string | null = null,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      Response.json(
        String(input).endsWith('/emails')
          ? emails
          : {
              id: 42,
              login: 'test-user',
              email: profileEmail,
              name: 'Test user',
            },
      ),
    ),
  )
  return getGitHubUserInfo({ accessToken: 'test-provider-token' })
}

test('GitHub rejects an unverified address without storing a linkable identity', async () => {
  expect(
    await github([
      { email: 'victim@example.com', verified: false, primary: true },
    ]),
  ).toBeNull()
  expect(await db.select().from(verification)).toEqual([])
})

test('GitHub selects the verified primary address rather than an unverified public profile address', async () => {
  const result = await github(
    [
      { email: 'victim@example.com', verified: false, primary: false },
      { email: 'owner@example.com', verified: true, primary: true },
    ],
    'victim@example.com',
  )
  expect(result?.user).toMatchObject({
    email: 'owner@example.com',
    emailVerified: true,
  })
})

test.each([false, undefined, 'true'])(
  'Google rejects email_verified=%s before storing provider identity',
  async (verified) => {
    const idToken = await new SignJWT({
      sub: 'test-google-subject',
      email: 'victim@example.com',
      email_verified: verified,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('test-only-id-token-signature'))
    expect(await getGoogleUserInfo({ idToken })).toBeNull()
    expect(await db.select().from(verification)).toEqual([])
  },
)

test('Google accepts an explicitly verified address', async () => {
  const idToken = await new SignJWT({
    sub: 'test-google-subject',
    email: 'owner@example.com',
    email_verified: true,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode('test-only-id-token-signature'))
  expect((await getGoogleUserInfo({ idToken }))?.user).toMatchObject({
    email: 'owner@example.com',
    emailVerified: true,
  })
})
