import { describe, expect, test } from 'vitest'

import {
  buildEmailChangeMessage,
  buildEmailVerificationMessage,
  buildOtpEmailMessage,
  buildTeamInviteEmailMessage,
} from './service'

describe('email message builders', () => {
  test('builds the OTP email message', async () => {
    const message = await buildOtpEmailMessage('ronan@example.com', '123456')

    expect(message.subject).toBe('Your temporary code is 123456')
    expect(message.text).toContain('Enter this temporary verification code')
    expect(message.text).toContain('123456')
    expect(message.html).toContain('Sign in to devpush')
    expect(message.html).toContain('123456')
  })

  test('builds the team invite email message with escaped HTML content', async () => {
    const message = await buildTeamInviteEmailMessage({
      email: 'invitee@example.com',
      inviteUrl: 'https://devpu.sh/invites/token',
      teamName: 'R&D <Team>',
    })

    expect(message.subject).toBe('Join R&D <Team> on devpush')
    expect(message.text).toContain('You have been invited to join R&D <Team>')
    expect(message.text).toContain('https://devpu.sh/invites/token')
    expect(message.html).toContain('Join R&amp;D &lt;Team&gt; on devpush')
    expect(message.html).toContain('Accept invitation')
    expect(message.html).toContain('https://devpu.sh/invites/token')
    expect(message.html).not.toContain('<Team>')
  })

  test('builds the email change message with escaped HTML content', () => {
    const message = buildEmailChangeMessage({
      currentEmail: 'old@example.com',
      newEmail: 'new+test@example.com',
      verifyUrl: 'https://devpu.sh/api/auth/verify?token=<token>&email=new',
    })

    expect(message.subject).toBe('Verify your new devpush email address')
    expect(message.text).toContain(
      'Confirm that you want to use new+test@example.com',
    )
    expect(message.text).toContain(
      'This request was made from old@example.com.',
    )
    expect(message.html).toContain('new+test@example.com')
    expect(message.html).toContain(
      'https://devpu.sh/api/auth/verify?token=&lt;token&gt;&amp;email=new',
    )
    expect(message.html).not.toContain('<token>')
  })

  test('builds the email verification message with escaped HTML content', () => {
    const message = buildEmailVerificationMessage({
      email: 'verify@example.com',
      verifyUrl: 'https://devpu.sh/api/auth/verify?token=<token>&email=verify',
    })

    expect(message.subject).toBe('Verify your devpush email address')
    expect(message.text).toContain(
      'Verify email address: https://devpu.sh/api/auth/verify?token=<token>&email=verify',
    )
    expect(message.text).toContain(
      'This email was intended for verify@example.com.',
    )
    expect(message.html).toContain(
      'https://devpu.sh/api/auth/verify?token=&lt;token&gt;&amp;email=verify',
    )
    expect(message.html).not.toContain('<token>')
  })
})
