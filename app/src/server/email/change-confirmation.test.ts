import { expect, test, vi } from 'vitest'
import { sendEmailChangeEmail } from './service'

const mocks = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({ error: null }),
}))
vi.mock('@/server/config', () => ({
  config: {
    EMAIL_FROM: 'Test <test@example.invalid>',
    RESEND_API_KEY: 'test-only-key',
  },
}))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))

test('email-change approval is delivered to the current mailbox, not the requested new address', async () => {
  await sendEmailChangeEmail({
    currentEmail: 'owner@example.com',
    newEmail: 'requested@example.com',
    verifyUrl: 'https://example.com/approval',
  })
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: 'owner@example.com',
      subject: 'Confirm your devpush email change',
    }),
  )
})
