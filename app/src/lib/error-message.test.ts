import { describe, expect, test } from 'vitest'
import { getErrorMessage, getFieldErrorMessage } from './error-message'

const fallback = 'Unable to send sign-in code. Please try again.'

describe('user-facing errors', () => {
  test.each([
    { message: 'HTTPError' },
    { status: 500, message: 'Internal details from a provider' },
    { statusCode: 503, message: 'Service unavailable' },
    new Error('Failed query: select * from users'),
    new Error('D1_TYPE_ERROR: unsupported value'),
    new Error('SQLITE_BUSY: database is locked'),
    new Error('Resend failed to send email: invalid API key'),
    new Error('Internal Server Error'),
    new TypeError('Cannot read properties of undefined'),
    '<!DOCTYPE html><html>Bad gateway</html>',
  ])('uses the action fallback for technical failures: %j', (error) => {
    expect(getErrorMessage(error, fallback)).toBe(fallback)
    expect(getFieldErrorMessage({ error, fallback, field: 'email' })).toBe(
      fallback,
    )
  })

  test.each([
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
  ])('explains connection failures: %s', (message) => {
    expect(getErrorMessage(new Error(message), fallback)).toBe(
      'Unable to connect. Check your connection and try again.',
    )
  })

  test('keeps actionable validation and permission messages', () => {
    expect(
      getErrorMessage({ status: 400, message: 'Invalid code' }, fallback),
    ).toBe('Invalid code')
    expect(
      getErrorMessage(
        new Error('Only team owners can delete a team.'),
        fallback,
      ),
    ).toBe('Only team owners can delete a team.')
    const error = new Error(
      JSON.stringify([
        { path: ['name'], message: 'Enter a name.' },
        { path: ['email'], message: 'Invalid email address.' },
      ]),
    )
    expect(getFieldErrorMessage({ error, fallback, field: 'email' })).toBe(
      'Invalid email address.',
    )
  })

  test('explains generic rate-limit responses', () => {
    expect(
      getErrorMessage({ status: 429, message: 'HTTPError' }, fallback),
    ).toBe('Too many attempts. Please wait a moment and try again.')
  })
})
