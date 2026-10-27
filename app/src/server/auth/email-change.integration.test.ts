import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeSignature } from 'better-auth/crypto'
import { SignJWT } from 'jose'
import { db, closeDb } from '#devpush/server/db'
import { allowlist, session, user } from '#devpush/server/db/schema'
import { config } from '#devpush/server/config'
import { auth } from './better-auth'

const email = vi.hoisted(() => ({
  change: vi.fn().mockResolvedValue(undefined),
  verify: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('#devpush/server/email/service', () => ({
  sendEmailChangeEmail: email.change,
  sendEmailVerificationEmail: email.verify,
  sendOtpEmail: vi.fn(),
}))
let userId = ''
afterEach(async () => {
  if (userId) await db.delete(user).where(eq(user.id, userId))
  await db.delete(allowlist)
  vi.clearAllMocks()
})
afterAll(closeDb)
async function fixture() {
  userId = crypto.randomUUID()
  const currentEmail = `${userId}@allowed.example`
  const token = crypto.randomUUID()
  await db.insert(user).values({
    id: userId,
    name: 'Email owner',
    username: `u-${userId}`,
    email: currentEmail,
    emailVerified: true,
  })
  await db.insert(session).values({
    id: crypto.randomUUID(),
    userId,
    token,
    expiresAt: new Date(Date.now() + 60_000),
  })
  await db.insert(allowlist).values({
    id: crypto.randomUUID(),
    type: 'domain',
    value: 'allowed.example',
  })
  const signed = await makeSignature(token, config.BETTER_AUTH_SECRET)
  return {
    currentEmail,
    headers: {
      origin: config.BETTER_AUTH_URL,
      'content-type': 'application/json',
      cookie: `devpush.session_token=${encodeURIComponent(`${token}.${signed}`)}`,
    },
  }
}

test('direct auth email-change requests reject disallowed new addresses before sending approval', async () => {
  const { headers } = await fixture()
  const response = await auth.handler(
    new Request(`${config.BETTER_AUTH_URL}/api/auth/change-email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ newEmail: 'outside@example.com' }),
    }),
  )
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({
    code: 'ACCOUNT_EMAIL_NOT_ALLOWED',
  })
  expect(email.change).not.toHaveBeenCalled()
})

test('allowed email changes first request approval using the current verified mailbox', async () => {
  const { currentEmail, headers } = await fixture()
  const response = await auth.handler(
    new Request(`${config.BETTER_AUTH_URL}/api/auth/change-email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ newEmail: 'next@allowed.example' }),
    }),
  )
  expect(response.status).toBe(200)
  expect(email.change).toHaveBeenCalledWith(
    expect.objectContaining({ currentEmail, newEmail: 'next@allowed.example' }),
  )
  expect(email.verify).not.toHaveBeenCalled()
})

test('the final email verification rechecks a changed allowlist before modifying the account', async () => {
  const { currentEmail, headers } = await fixture()
  const newEmail = 'next@allowed.example'
  const token = await new SignJWT({
    email: currentEmail,
    updateTo: newEmail,
    requestType: 'change-email-verification',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(config.BETTER_AUTH_SECRET))
  await db.update(allowlist).set({ type: 'email', value: currentEmail })
  await expect(
    auth.api.verifyEmail({ query: { token }, headers }),
  ).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'ACCOUNT_EMAIL_NOT_ALLOWED' }),
  })
  expect(
    (await db.select().from(user).where(eq(user.id, userId)))[0]?.email,
  ).toBe(currentEmail)
})

test('approval reports failed delivery to the new mailbox without changing the account', async () => {
  const { currentEmail, headers } = await fixture()
  const token = await new SignJWT({
    email: currentEmail,
    updateTo: 'next@allowed.example',
    requestType: 'change-email-confirmation',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(config.BETTER_AUTH_SECRET))
  email.verify.mockRejectedValueOnce(new Error('delivery unavailable'))
  await expect(
    auth.api.verifyEmail({ query: { token }, headers }),
  ).rejects.toMatchObject({
    statusCode: 503,
    body: expect.objectContaining({ code: 'EMAIL_SEND_FAILED' }),
  })
  expect(
    (await db.select().from(user).where(eq(user.id, userId)))[0]?.email,
  ).toBe(currentEmail)
})

test('email changes require both current-mailbox approval and new-mailbox verification', async () => {
  const { currentEmail, headers } = await fixture()
  const newEmail = 'next@allowed.example'
  await auth.api.changeEmail({ body: { newEmail }, headers })
  const approvalUrl = email.change.mock.calls[0]![0].verifyUrl as string
  await auth.api.verifyEmail({
    query: { token: new URL(approvalUrl).searchParams.get('token')! },
    headers,
  })
  expect(email.verify).toHaveBeenCalledWith(
    expect.objectContaining({ email: newEmail }),
  )
  expect(
    (await db.select().from(user).where(eq(user.id, userId)))[0]?.email,
  ).toBe(currentEmail)
  const verificationUrl = email.verify.mock.calls[0]![0].verifyUrl as string
  await auth.api.verifyEmail({
    query: { token: new URL(verificationUrl).searchParams.get('token')! },
    headers,
  })
  expect(
    (await db.select().from(user).where(eq(user.id, userId)))[0],
  ).toMatchObject({ email: newEmail, emailVerified: true })
})
