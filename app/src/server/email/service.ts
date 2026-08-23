import { render } from '@react-email/render'
import { Resend } from 'resend'

import { config } from '@/server/config'
import { OtpEmailTemplate } from '@/server/email/otp-template'
import { TeamInviteEmailTemplate } from '@/server/email/team-invite-template'

type EmailPayload = {
  html: string
  subject: string
  text: string
  to: string
}

async function sendEmail({ html, subject, text, to }: EmailPayload) {
  if (!config.EMAIL_FROM) {
    throw new Error('EMAIL_FROM is not configured.')
  }

  if (!config.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured.')
  }

  const resend = new Resend(config.RESEND_API_KEY)

  const result = await resend.emails.send({
    from: config.EMAIL_FROM,
    html,
    subject,
    text,
    to,
  })

  if (result.error) {
    throw new Error(`Resend failed to send email: ${result.error.message}`)
  }
}

export async function sendOtpEmail(email: string, otp: string) {
  const message = await buildOtpEmailMessage(email, otp)

  await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}

export async function sendEmailChangeEmail({
  currentEmail,
  newEmail,
  verifyUrl,
}: {
  currentEmail: string
  newEmail: string
  verifyUrl: string
}) {
  const message = buildEmailChangeMessage({
    currentEmail,
    newEmail,
    verifyUrl,
  })

  await sendEmail({
    to: newEmail,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}

export function buildEmailChangeMessage({
  currentEmail,
  newEmail,
  verifyUrl,
}: {
  currentEmail: string
  newEmail: string
  verifyUrl: string
}) {
  return {
    subject: 'Verify your new devpush email address',
    html: `<p>Confirm that you want to use ${escapeHtml(newEmail)} for devpush.</p><p><a href="${escapeHtml(verifyUrl)}">Verify email address</a></p>`,
    text: `Confirm that you want to use ${newEmail} for devpush.

Verify email address: ${verifyUrl}

This request was made from ${currentEmail}.`,
  }
}

export async function sendEmailVerificationEmail({
  email,
  verifyUrl,
}: {
  email: string
  verifyUrl: string
}) {
  const message = buildEmailVerificationMessage({ email, verifyUrl })

  await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}

export function buildEmailVerificationMessage({
  email,
  verifyUrl,
}: {
  email: string
  verifyUrl: string
}) {
  return {
    subject: 'Verify your devpush email address',
    html: `<p>Verify your email address for devpush.</p><p><a href="${escapeHtml(verifyUrl)}">Verify email address</a></p>`,
    text: `Verify your email address for devpush.

Verify email address: ${verifyUrl}

This email was intended for ${email}. If you think this is a mistake, you can safely ignore this email.`,
  }
}

export async function buildOtpEmailMessage(email: string, otp: string) {
  const subject = `Your temporary code is ${otp}`
  const html = await render(
    OtpEmailTemplate({ otp, preview: subject, to: email }),
  )

  return {
    subject,
    html,
    text: `Your temporary code is ${otp}

Sign in to devpush

Enter this temporary verification code to continue:

${otp}

This code will expire in 5 minutes.

This email was intended for ${email}. If you think this is a mistake, you can safely ignore this email.`,
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendTeamInviteEmail({
  email,
  inviteUrl,
  teamName,
}: {
  email: string
  inviteUrl: string
  teamName: string
}) {
  const message = await buildTeamInviteEmailMessage({
    email,
    inviteUrl,
    teamName,
  })

  await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}

export async function buildTeamInviteEmailMessage({
  email,
  inviteUrl,
  teamName,
}: {
  email: string
  inviteUrl: string
  teamName: string
}) {
  const subject = `Join ${teamName} on devpush`
  const html = await render(
    TeamInviteEmailTemplate({
      inviteUrl,
      preview: subject,
      teamName,
      to: email,
    }),
  )

  return {
    subject,
    html,
    text: `Join ${teamName} on devpush

You have been invited to join ${teamName} on devpush.

Accept invitation: ${inviteUrl}

This email was intended for ${email}. If you think this is a mistake, you can safely ignore this email.`,
  }
}
