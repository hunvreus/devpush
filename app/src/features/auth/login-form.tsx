import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { authClient } from '@/lib/auth/client'
import type { AuthMethods } from '@/lib/auth/config'
import { getErrorMessage } from '@/lib/error-message'
import { isValidEmail } from '@/lib/validation'

type PendingAction = null | 'email' | 'otp' | 'github' | 'google'

export function LoginForm({
  authMethods,
  redirectPath,
}: {
  authMethods: AuthMethods
  redirectPath: string
}) {
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [pending, setPending] = useState<PendingAction>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [otpError, setOtpError] = useState<string | null>(null)

  const busy = pending !== null

  async function sendOtp() {
    const normalizedEmail = email.trim().toLocaleLowerCase()
    setEmailError(null)

    if (!isValidEmail(normalizedEmail)) {
      setEmailError(
        normalizedEmail ? 'Invalid email address' : 'Enter your email address.',
      )
      return
    }

    setPending('email')

    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: normalizedEmail,
        type: 'sign-in',
      })

      if (result.error) {
        setEmailError(
          getErrorMessage(result.error, 'Unable to send sign-in code.'),
        )
        return
      }

      setEmail(normalizedEmail)
      setOtp('')
      setStep('otp')
    } catch {
      setEmailError('Unable to send sign-in code.')
    } finally {
      setPending(null)
    }
  }

  async function verifyOtp() {
    if (otp.length !== 6) {
      setOtpError('Enter the 6-digit code.')
      return
    }

    setOtpError(null)
    setPending('otp')

    try {
      const result = await authClient.signIn.emailOtp({ email, otp })

      if (result.error) {
        setOtpError(getErrorMessage(result.error, 'Unable to verify code.'))
        return
      }

      window.location.assign(redirectPath)
    } catch {
      setOtpError('Unable to verify code.')
    } finally {
      setPending(null)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (step === 'email') {
      await sendOtp()
      return
    }

    await verifyOtp()
  }

  async function signInWithProvider(provider: 'github' | 'google') {
    setPending(provider)

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: redirectPath,
      })

      if (result.error) {
        toast.error(
          getErrorMessage(result.error, `Unable to sign in with ${provider}.`),
        )
        setPending(null)
      }
    } catch {
      toast.error(`Unable to sign in with ${provider}.`)
      setPending(null)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-xs">
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <h1 className="text-center leading-snug font-medium">
              Sign in to devpush
            </h1>
            {step === 'email' ? (
              <EmailStep
                busy={busy}
                email={email}
                error={emailError}
                pending={pending}
                onEmailChange={(value) => {
                  setEmail(value)
                  setEmailError(null)
                }}
                authMethods={authMethods}
                onProviderSignIn={signInWithProvider}
              />
            ) : (
              <OtpStep
                busy={busy}
                email={email}
                error={otpError}
                otp={otp}
                pending={pending}
                onOtpChange={(value) => {
                  setOtp(value)
                  setOtpError(null)
                }}
                onReset={() => {
                  setStep('email')
                  setOtp('')
                  setOtpError(null)
                }}
                onResend={() => void sendOtp()}
              />
            )}
          </FieldGroup>
        </form>
      </div>
    </main>
  )
}

function EmailStep({
  busy,
  email,
  error,
  pending,
  authMethods,
  onEmailChange,
  onProviderSignIn,
}: {
  busy: boolean
  email: string
  error: string | null
  pending: PendingAction
  authMethods: AuthMethods
  onEmailChange: (value: string) => void
  onProviderSignIn: (provider: 'github' | 'google') => Promise<void>
}) {
  const hasSocialProvider = authMethods.github || authMethods.google

  return (
    <>
      <div className="grid gap-3">
        <Field data-invalid={Boolean(error)}>
          <Input
            aria-invalid={Boolean(error)}
            id="email"
            type="email"
            placeholder="Enter your email"
            autoComplete="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            disabled={busy}
            required
          />
          <FieldError>{error}</FieldError>
        </Field>

        <Field>
          <Button type="submit" disabled={busy}>
            Continue with email
            {pending === 'email' ? <Spinner data-icon="inline-end" /> : null}
          </Button>
        </Field>
      </div>

      {hasSocialProvider ? (
        <>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>Or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Field>
            {authMethods.github ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onProviderSignIn('github')}
              >
                <GithubIcon data-icon="inline-start" />
                Continue with GitHub
                {pending === 'github' ? (
                  <Spinner data-icon="inline-end" />
                ) : null}
              </Button>
            ) : null}
            {authMethods.google ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onProviderSignIn('google')}
              >
                <GoogleIcon data-icon="inline-start" />
                Continue with Google
                {pending === 'google' ? (
                  <Spinner data-icon="inline-end" />
                ) : null}
              </Button>
            ) : null}
          </Field>
        </>
      ) : null}
    </>
  )
}

function OtpStep({
  busy,
  email,
  error,
  otp,
  pending,
  onOtpChange,
  onReset,
  onResend,
}: {
  busy: boolean
  email: string
  error: string | null
  otp: string
  pending: PendingAction
  onOtpChange: (value: string) => void
  onReset: () => void
  onResend: () => void
}) {
  return (
    <>
      <Field className="items-center text-center" data-invalid={Boolean(error)}>
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code sent to {email}.
        </p>
        <InputOTP
          aria-invalid={Boolean(error)}
          autoFocus
          containerClassName="justify-center"
          disabled={busy}
          maxLength={6}
          onChange={onOtpChange}
          value={otp}
        >
          <InputOTPGroup>
            {Array.from({ length: 6 }, (_, index) => (
              <InputOTPSlot index={index} key={index} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <FieldError>{error}</FieldError>
      </Field>

      <Field>
        <Button type="submit" disabled={busy || otp.length !== 6}>
          Verify code
          {pending === 'otp' ? <Spinner data-icon="inline-end" /> : null}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onResend}
        >
          Resend code
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onReset}>
          Sign in another way
        </Button>
      </Field>
    </>
  )
}

type InlineIconProps = {
  'data-icon'?: 'inline-start' | 'inline-end'
}

function Spinner({ 'data-icon': dataIcon }: InlineIconProps) {
  return <LoaderCircle data-icon={dataIcon} className="size-4 animate-spin" />
}

function GithubIcon({ 'data-icon': dataIcon }: InlineIconProps) {
  return (
    <svg
      data-icon={dataIcon}
      role="img"
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function GoogleIcon({ 'data-icon': dataIcon }: InlineIconProps) {
  return (
    <svg
      data-icon={dataIcon}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="size-4"
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}
