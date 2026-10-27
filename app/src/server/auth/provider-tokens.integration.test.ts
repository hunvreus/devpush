import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { db, closeDb } from '#devpush/server/db'
import { account, user, verification } from '#devpush/server/db/schema'
import { auth, getGoogleUserInfo } from './better-auth'
import {
  encryptExistingProviderTokens,
  readProviderToken,
  storeProviderToken,
} from './provider-tokens'
import { getGitHubAccount } from '#devpush/server/github/service'

vi.mock('#devpush/server/auth/auth-methods', () => ({
  getAuthMethods: () => ({ github: true, google: true, email: false }),
  getGitHubOAuthCredentials: () => ({
    clientId: 'fixture-client',
    clientSecret: 'fixture-secret',
  }),
}))
const ids: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const id of ids.splice(0)) await db.delete(user).where(eq(user.id, id))
  await db.delete(verification)
})
afterAll(closeDb)

async function owner() {
  const id = crypto.randomUUID()
  ids.push(id)
  await db
    .insert(user)
    .values({ id, username: id, name: 'Owner', email: `${id}@example.test` })
  return id
}

async function jwt() {
  return new SignJWT({
    sub: 'google-id',
    email: 'owner@example.test',
    email_verified: true,
    name: 'Owner',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode('test-signing-key'))
}

test('rewrites existing tokens in bounded batches and keeps GitHub reads working', async () => {
  const id = await owner(),
    idToken = await jwt()
  await db.insert(account).values({
    id,
    userId: id,
    accountId: 'github-id',
    providerId: 'github',
    providerAccountUsername: 'owner',
    accessToken: 'gho_plain-access',
    refreshToken: 'refresh-plain',
    idToken,
  })
  expect(await encryptExistingProviderTokens({ limit: 1 })).toEqual({
    checked: 1,
    encrypted: 1,
  })
  const [saved] = await db.select().from(account).where(eq(account.id, id))
  expect(saved!.accessToken).not.toBe('gho_plain-access')
  expect(saved!.refreshToken).not.toBe('refresh-plain')
  expect(saved!.idToken).not.toBe(idToken)
  expect(await readProviderToken(saved!.accessToken!)).toBe('gho_plain-access')
  expect(await readProviderToken(saved!.refreshToken!)).toBe('refresh-plain')
  expect(await readProviderToken(saved!.idToken!)).toBe(idToken)
  expect(await getGitHubAccount(id)).toEqual({
    login: 'owner',
    accessToken: 'gho_plain-access',
  })
  expect(await getGoogleUserInfo({ idToken: saved!.idToken! })).toMatchObject({
    user: { email: 'owner@example.test' },
  })
  expect(await encryptExistingProviderTokens()).toEqual({
    checked: 0,
    encrypted: 0,
  })
})

test('Better Auth encrypts ID tokens on account creation and replacement', async () => {
  const id = await owner(),
    idToken = await jwt(),
    context = await auth.$context
  const created = await context.internalAdapter.createAccount({
    userId: id,
    accountId: 'google-id',
    providerId: 'google',
    idToken,
  })
  let [saved] = await db
    .select()
    .from(account)
    .where(eq(account.id, created.id))
  expect(saved!.idToken).not.toBe(idToken)
  expect(await readProviderToken(saved!.idToken!)).toBe(idToken)
  await context.internalAdapter.updateAccount(created.id, { idToken })
  ;[saved] = await db.select().from(account).where(eq(account.id, created.id))
  expect(await readProviderToken(saved!.idToken!)).toBe(idToken)
})

test('rewrites do not re-encrypt already encrypted values in mixed records', async () => {
  const id = await owner(),
    encrypted = await storeProviderToken('gho_original')
  await db.insert(account).values({
    id,
    userId: id,
    accountId: 'github-id',
    providerId: 'github',
    accessToken: encrypted,
    refreshToken: 'new-plaintext',
  })
  await encryptExistingProviderTokens()
  const [saved] = await db.select().from(account).where(eq(account.id, id))
  expect(saved!.accessToken).toBe(encrypted)
  expect(await readProviderToken(saved!.refreshToken!)).toBe('new-plaintext')
})

test('a failed rewrite does not expose token-bearing SQL diagnostics', async () => {
  const id = await owner()
  await db.insert(account).values({
    id,
    userId: id,
    providerId: 'github',
    accountId: 'provider-id',
    accessToken: 'gho_private_value',
  })
  vi.spyOn(db, 'update').mockImplementationOnce(() => {
    throw new Error('SQL failed params: gho_private_value')
  })
  const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(encryptExistingProviderTokens()).rejects.toThrow(
    'Unable to encrypt existing provider tokens.',
  )
  expect(JSON.stringify(logs.mock.calls)).not.toContain('gho_private_value')
})

test('legacy 40-character GitHub tokens are plaintext, not encrypted payloads', async () => {
  const id = await owner(),
    token = 'a'.repeat(40)
  await db.insert(account).values({
    id,
    userId: id,
    providerId: 'github',
    accountId: 'legacy-github',
    accessToken: token,
  })
  expect(await readProviderToken(token)).toBe(token)
  expect(await encryptExistingProviderTokens()).toEqual({
    checked: 1,
    encrypted: 1,
  })
  const [saved] = await db.select().from(account).where(eq(account.id, id))
  expect(saved!.accessToken).not.toBe(token)
  expect(await readProviderToken(saved!.accessToken!)).toBe(token)
})

test('a concurrent profile update keeps its timestamp and defers token rewriting', async () => {
  const id = await owner(),
    before = new Date(1),
    after = new Date(Date.now() + 60_000)
  await db.insert(account).values({
    id,
    userId: id,
    providerId: 'github',
    accountId: 'provider-id',
    accessToken: 'gho_original',
    updatedAt: before,
  })
  const rewrite = encryptExistingProviderTokens()
  await db
    .update(account)
    .set({ providerAccountName: 'Updated profile', updatedAt: after })
    .where(eq(account.id, id))
  expect(await rewrite).toEqual({ checked: 1, encrypted: 0 })
  const [saved] = await db.select().from(account).where(eq(account.id, id))
  expect(saved!.updatedAt).toEqual(after)
  expect(saved!.providerAccountName).toBe('Updated profile')
  expect(await encryptExistingProviderTokens()).toEqual({
    checked: 1,
    encrypted: 1,
  })
  expect(
    (await db.select().from(account).where(eq(account.id, id)))[0]!.updatedAt,
  ).toEqual(after)
})
