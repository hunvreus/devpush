import { safeErrorDiagnostics } from '#devpush/server/http/error-diagnostics'
import { config } from '#devpush/server/config'

type EmailPayload = {
  from?: string
  html: string
  subject: string
  text: string
  to: string
}

export async function sendEmail(
  { from = config.EMAIL_FROM, html, subject, text, to }: EmailPayload,
  idempotencyKey?: string,
) {
  if (!from) {
    throw new Error('EMAIL_FROM is not configured.')
  }

  if (!config.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured.')
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        html,
        subject,
        text,
        to,
      }),
    })
    // Only provider acceptance matters here; never retain or surface its body.
    await response.body?.cancel().catch(() => undefined)
    if (!response.ok) {
      console.warn('Email provider rejected delivery.', {
        status: response.status,
      })
      throw new Error('Email provider rejected delivery.')
    }
  } catch (error) {
    console.warn('Email delivery failed.', safeErrorDiagnostics(error))
    throw new Error('Unable to deliver email.')
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
  const message = await buildEmailChangeMessage({
    currentEmail,
    newEmail,
    verifyUrl,
  })

  await sendEmail({
    to: currentEmail,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}

export async function buildEmailChangeMessage({
  currentEmail,
  newEmail,
  verifyUrl,
}: {
  currentEmail: string
  newEmail: string
  verifyUrl: string
}) {
  return {
    subject: 'Confirm your devpush email change',
    html: await renderNotificationEmail({
      title: 'Confirm your devpush email change',
      to: currentEmail,
      message: `Confirm that you want to use ${newEmail} for devpush.\nAfter confirmation, we will ask you to verify the new address.`,
      action: { label: 'Confirm email change', url: verifyUrl },
    }),
    text: `Confirm that you want to use ${newEmail} for devpush.

Confirm email change: ${verifyUrl}

This request was made from ${currentEmail}. After confirmation, we will ask you to verify the new address.`,
  }
}

export async function sendEmailVerificationEmail({
  email,
  verifyUrl,
}: {
  email: string
  verifyUrl: string
}) {
  const message = await buildEmailVerificationMessage({ email, verifyUrl })

  await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}

export async function buildEmailVerificationMessage({
  email,
  verifyUrl,
}: {
  email: string
  verifyUrl: string
}) {
  return {
    subject: 'Verify your devpush email address',
    html: await renderNotificationEmail({
      title: 'Verify your devpush email address',
      to: email,
      message: 'Verify your email address for devpush.',
      action: { label: 'Verify email address', url: verifyUrl },
    }),
    text: `Verify your email address for devpush.

Verify email address: ${verifyUrl}

This email was intended for ${email}. If you think this is a mistake, you can safely ignore this email.`,
  }
}

export async function buildOtpEmailMessage(email: string, otp: string) {
  const [{ render }, { OtpEmailTemplate }] = await Promise.all([
    import('@react-email/render'),
    import('#devpush/server/email/otp-template'),
  ])
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

export async function renderNotificationEmail(input: {
  title: string
  message: string
  to: string
  action?: { label: string; url: string }
}) {
  const [{ render }, { NotificationEmailTemplate }] = await Promise.all([
    import('@react-email/render'),
    import('./notification-template'),
  ])
  return render(NotificationEmailTemplate(input))
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
  const [{ render }, { TeamInviteEmailTemplate }] = await Promise.all([
    import('@react-email/render'),
    import('#devpush/server/email/team-invite-template'),
  ])
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
