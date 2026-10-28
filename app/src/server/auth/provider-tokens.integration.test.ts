import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { db, closeDb } from '#devpush/server/db'
import { account, user, verification } from '#devpush/server/db/schema'
import { auth } from './better-auth'
import { readProviderToken } from './provider-tokens'

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
