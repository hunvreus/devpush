import {
  encryptExistingProviderTokens,
  readProviderToken,
} from '@/server/auth/provider-tokens'
import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, closeDb } from '@/server/db'
import { account, user } from '@/server/db/schema'
import { getGitHubAccount } from './service'

vi.mock('@/server/auth/auth-methods', () => ({
  getAuthMethods: () => ({ github: true, google: false, email: false }),
  getGitHubOAuthCredentials: () => ({
    clientId: 'fixture-client',
    clientSecret: 'fixture-secret',
  }),
}))
let id = ''
afterEach(async () => {
  vi.unstubAllGlobals()
  if (id) await db.delete(user).where(eq(user.id, id))
})
afterAll(closeDb)
async function fixture(
  expiresAt: Date | null,
  refreshToken: string | null = 'refresh-before',
) {
  id = crypto.randomUUID()
  await db
    .insert(user)
    .values({ id, username: id, name: 'Owner', email: `${id}@example.com` })
  await db.insert(account).values({
    id,
    userId: id,
    providerId: 'github',
    accountId: '123',
    providerAccountUsername: 'owner',
    accessToken: 'access-before',
    accessTokenExpiresAt: expiresAt,
    refreshToken,
  })
}

test('expiring GitHub credentials refresh through Better Auth and persist rotated tokens', async () => {
  await fixture(new Date(Date.now() - 60_000))
  await encryptExistingProviderTokens()
  const request = vi.fn().mockResolvedValue(
    Response.json({
      access_token: 'access-after',
      refresh_token: 'refresh-after',
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      token_type: 'bearer',
      scope: 'read:user',
    }),
  )
  vi.stubGlobal('fetch', request)
  expect(await getGitHubAccount(id)).toEqual({
    login: 'owner',
    accessToken: 'access-after',
  })
  expect(request).toHaveBeenCalledOnce()
  const [saved] = await db.select().from(account).where(eq(account.id, id))
  expect(saved?.accessToken).not.toBe('access-after')
  expect(await readProviderToken(saved!.accessToken!)).toBe('access-after')
  expect(await readProviderToken(saved!.refreshToken!)).toBe('refresh-after')
  expect(saved?.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
})

test.each([null, new Date(Date.now() + 3600_000)])(
  'valid GitHub credentials do not refresh: %s',
  async (expiry) => {
    await fixture(expiry)
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    expect(await getGitHubAccount(id)).toEqual({
      login: 'owner',
      accessToken: 'access-before',
    })
    expect(request).not.toHaveBeenCalled()
  },
)

test('expired GitHub access without a refresh token returns a reconnect error', async () => {
  await fixture(new Date(Date.now() - 60_000), null)
  await expect(getGitHubAccount(id)).rejects.toMatchObject({
    code: 'GITHUB_ACCESS_REFRESH_FAILED',
  })
})

test('provider refresh rejection returns a safe error and preserves existing credentials', async () => {
  await fixture(new Date(Date.now() - 60_000))
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: 'bad_refresh_token',
          error_description: 'private provider detail',
        },
        { status: 400 },
      ),
    ),
  )
  await expect(getGitHubAccount(id)).rejects.toMatchObject({
    code: 'GITHUB_ACCESS_REFRESH_FAILED',
  })
  expect(
    (await db.select().from(account).where(eq(account.id, id)))[0],
  ).toMatchObject({
    accessToken: 'access-before',
    refreshToken: 'refresh-before',
  })
})
