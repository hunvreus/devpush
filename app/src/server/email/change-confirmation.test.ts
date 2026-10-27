import { afterEach, expect, test, vi } from 'vitest'
import { sendEmailChangeEmail } from './service'

vi.mock('#devpush/server/config', () => ({
  config: {
    BETTER_AUTH_URL: 'https://devpush.example',
    EMAIL_FROM: 'Test <test@example.invalid>',
    RESEND_API_KEY: 'test-only-key',
  },
}))
afterEach(() => vi.unstubAllGlobals())

test('email-change approval is delivered to the current mailbox, not the requested new address', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'accepted' }))
  vi.stubGlobal('fetch', fetch)
  await sendEmailChangeEmail({
    currentEmail: 'owner@example.com',
    newEmail: 'requested@example.com',
    verifyUrl: 'https://example.com/approval',
  })
  const options = fetch.mock.calls[0]![1] as RequestInit
  expect(JSON.parse(String(options.body))).toMatchObject({
    to: 'owner@example.com',
    subject: 'Confirm your devpush email change',
  })
})
