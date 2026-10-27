// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LoginForm } from './login-form'

const auth = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn() }))
vi.mock('#devpush/lib/auth/client', () => ({
  authClient: {
    emailOtp: { sendVerificationOtp: auth.send },
    signIn: { emailOtp: auth.verify },
  },
}))
vi.mock('#devpush/components/ui/input-otp', () => ({
  InputOTP: ({
    onChange,
    disabled,
    value,
  }: {
    onChange: (value: string) => void
    disabled: boolean
    value: string
  }) => (
    <input
      aria-label="Code"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  InputOTPGroup: () => null,
  InputOTPSlot: () => null,
}))
let element: HTMLDivElement
let root: Root
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  auth.send.mockReset()
  auth.verify.mockReset()
  element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  await act(async () =>
    root.render(
      <LoginForm
        authMethods={{ email: true, github: false, google: false }}
        redirectPath="#signed-in"
      />,
    ),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  element.remove()
  vi.unstubAllGlobals()
})
async function fill(selector: string, value: string) {
  const input = element.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error('Missing input')
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => {
    element
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
function button() {
  const value = element.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )
  if (!value) throw new Error('Missing submit button')
  return value
}
async function codeStep() {
  auth.send.mockResolvedValueOnce({})
  await fill('#email', 'test@example.com')
  await submit()
  await fill('[aria-label="Code"]', '123456')
}
test('immediately explains sending and stays on the email step after failure', async () => {
  let finish!: (value: unknown) => void
  auth.send.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await fill('#email', 'test@example.com')
  await submit()
  expect(button().disabled).toBe(true)
  expect(button().textContent).toBe('Sending code…')
  await act(async () =>
    finish({ error: { status: 503, message: 'HTTPError' } }),
  )
  expect(button().disabled).toBe(false)
  expect(element.textContent).toContain('Unable to send your sign-in code.')
  expect(element.querySelector('[aria-label="Code"]')).toBeNull()
})
test('keeps the form disabled after verification until navigation leaves', async () => {
  await codeStep()
  let finish!: (value: unknown) => void
  auth.verify.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await submit()
  expect(button().textContent).toBe('Verifying code…')
  await act(async () => finish({}))
  expect(window.location.hash).toBe('#signed-in')
  expect(button().textContent).toBe('Signing you in…')
  expect(
    [...element.querySelectorAll('form button,form input')].every(
      (control) => (control as HTMLButtonElement).disabled,
    ),
  ).toBe(true)
})
test('allows retry after a rejected code', async () => {
  await codeStep()
  auth.verify.mockResolvedValueOnce({
    error: { status: 400, message: 'Invalid code' },
  })
  await submit()
  expect(button().disabled).toBe(false)
  expect(element.textContent).toContain('Invalid code')
})
test('shows resend failures on the code step', async () => {
  await codeStep()
  auth.send.mockResolvedValueOnce({
    error: { status: 503, message: 'HTTPError' },
  })
  const resend = [...element.querySelectorAll('button')].find(
    (item) => item.textContent === 'Resend code',
  )
  await act(async () => resend?.click())
  expect(element.textContent).toContain('Unable to send your sign-in code.')
  expect(button().disabled).toBe(false)
})

test('repeated form submission does not start another pending email request', async () => {
  let finish!: (value: unknown) => void
  auth.send.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await fill('#email', 'test@example.com')
  await submit()
  await submit()
  expect(auth.send).toHaveBeenCalledTimes(1)
  await act(async () => finish({}))
})
test('repeated verification does not start another request while pending', async () => {
  await codeStep()
  let finish!: (value: unknown) => void
  auth.verify.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await submit()
  await submit()
  expect(auth.verify).toHaveBeenCalledTimes(1)
  await act(async () => finish({ error: { message: 'Invalid code' } }))
})
