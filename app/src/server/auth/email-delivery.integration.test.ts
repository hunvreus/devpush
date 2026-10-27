import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { db, closeDb } from '#devpush/server/db'
import * as schema from '#devpush/server/db/schema'
import { requireAuthEmailDelivery } from './email-delivery'

const send = vi.fn<() => Promise<void>>()
const sendChange = vi.fn<() => Promise<void>>()
const auth = betterAuth({
  baseURL: 'http://localhost:7429',
  secret: crypto.randomUUID().repeat(2),
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  logger: { disabled: true },
  user: {
    additionalFields: {
      username: { type: 'string', required: false, input: false },
    },
    changeEmail: { enabled: true, sendChangeEmailConfirmation: sendChange },
  },
  emailVerification: { sendVerificationEmail: sendChange },
  plugins: [
    emailOTP({
      sendVerificationOTP: send,
      generateOTP: () => '123456',
      resendStrategy: 'reuse',
      storeOTP: 'encrypted',
    }),
    requireAuthEmailDelivery(),
  ],
})
afterAll(() => closeDb())
function request(email: string) {
  return auth.handler(
    new Request(
      'http://localhost:7429/api/auth/email-otp/send-verification-otp',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:7429',
        },
        body: JSON.stringify({ email, type: 'sign-in' }),
      },
    ),
  )
}

describe('OTP send acknowledgement', () => {
  test('does not acknowledge success before the provider completes', async () => {
    let finish!: () => void
    let started!: () => void
    const sending = new Promise<void>((resolve) => {
      started = resolve
    })
    send.mockImplementationOnce(() => {
      started()
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    let completed = false
    const response = request('pending@example.com').then((value) => {
      completed = true
      return value
    })
    await sending
    expect(completed).toBe(false)
    finish()
    expect((await response).status).toBe(200)
  })

  test('reports send failures safely and allows retry', async () => {
    send.mockRejectedValueOnce(new Error('provider secret diagnostic'))
    const failed = await request('retry@example.com')
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({
      code: 'OTP_SEND_FAILED',
      message:
        'Unable to send your sign-in code. Please try again in a moment.',
    })
    send.mockResolvedValueOnce(undefined)
    expect((await request('retry@example.com')).status).toBe(200)
  })

  test('keeps concurrent successful and failed requests isolated', async () => {
    send
      .mockRejectedValueOnce(new Error('provider error'))
      .mockResolvedValueOnce(undefined)
    const responses = await Promise.all([
      request('one@example.com'),
      request('two@example.com'),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 503,
    ])
  })
})

test('email changes report provider rejection instead of false success', async () => {
  await db.insert(schema.user).values({
    id: 'email-change-test',
    username: 'email-change-test',
    name: 'Test',
    email: 'change@example.com',
    emailVerified: true,
  })
  send.mockResolvedValueOnce(undefined)
  await request('change@example.com')
  const signIn = await auth.handler(
    new Request('http://localhost:7429/api/auth/sign-in/email-otp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:7429',
      },
      body: JSON.stringify({ email: 'change@example.com', otp: '123456' }),
    }),
  )
  expect(signIn.status).toBe(200)
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const change = () =>
    auth.handler(
      new Request('http://localhost:7429/api/auth/change-email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:7429',
          cookie,
        },
        body: JSON.stringify({
          newEmail: 'changed@example.com',
          callbackURL: '/settings',
        }),
      }),
    )
  sendChange.mockRejectedValueOnce(new Error('private provider error'))
  const failed = await change()
  expect(failed.status).toBe(503)
  expect(await failed.json()).toEqual({
    code: 'EMAIL_SEND_FAILED',
    message:
      'Unable to send the verification email. Please try again in a moment.',
  })
  sendChange.mockResolvedValueOnce(undefined)
  expect((await change()).status).toBe(200)
})
