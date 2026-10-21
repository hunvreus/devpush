import { expect, test } from 'vitest'
import {
  accountSettingsSchema,
  accountEmailSchema,
  accountValidationErrors,
  accountServiceErrors,
} from './account-settings-schema'

test('a valid avatar with an empty name reports the name as the invalid field', () => {
  const result = accountSettingsSchema.safeParse({
    settingsVersion: 1,
    name: '',
    username: 'hunvreus',
    avatarDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  })
  expect(result.success).toBe(false)
  if (!result.success)
    expect(accountValidationErrors(result.error.issues)).toEqual({
      name: 'Enter your name.',
    })
})
test('whitespace-only names are required too', () => {
  expect(
    accountSettingsSchema.safeParse({
      settingsVersion: 1,
      name: '   ',
      username: 'hunvreus',
    }).success,
  ).toBe(false)
})
test('avatar validation errors belong to the image field', () => {
  const result = accountSettingsSchema.safeParse({
    settingsVersion: 1,
    name: 'Ronan',
    username: 'hunvreus',
    avatarDataUrl: 'data:image/gif;base64,R0lG',
  })
  if (result.success) throw new Error('Expected validation failure')
  expect(accountValidationErrors(result.error.issues)).toEqual({
    avatarDataUrl: 'Upload a PNG, JPEG, or WebP image.',
  })
  expect(
    accountServiceErrors(
      new Error('The uploaded file does not match its image type.'),
    ),
  ).toEqual({
    avatarDataUrl: 'The uploaded file does not match its image type.',
  })
})
test('username conflicts map to username and unexpected failures are not field validation', () => {
  expect(accountServiceErrors(new Error('Username is already taken.'))).toEqual(
    { username: 'Username is already taken.' },
  )
  expect(accountServiceErrors(new Error('database failed'))).toBeNull()
})

test.each(['', 'invalid', 'x'.repeat(321) + '@example.com'])(
  'rejects invalid email changes',
  (newEmail) => {
    expect(
      accountEmailSchema.safeParse({ settingsVersion: 1, newEmail }).success,
    ).toBe(false)
  },
)
test('email changes normalize case and whitespace consistently', () => {
  expect(
    accountEmailSchema.parse({
      settingsVersion: 1,
      newEmail: ' New@Example.com ',
    }).newEmail,
  ).toBe('new@example.com')
})

test('unregistered username diagnostics are never returned as field errors', () => {
  expect(
    accountServiceErrors(new Error('Username lookup failed: private SQL')),
  ).toBeNull()
})
