import { createRequire } from 'node:module'
import { expect, test } from 'vitest'
import {
  PublicError,
  getPublicErrorMessage,
  publicErrorMessages,
} from './public-error'

const require = createRequire(import.meta.resolve('@tanstack/react-start'))
const serializer = (await import(require.resolve('seroval'))) as {
  toJSON: (value: unknown, options?: unknown) => unknown
  fromJSON: (value: unknown, options?: unknown) => unknown
}

test('public codes survive the serializer used by Start and messages come from the registry', () => {
  const decoded = serializer.fromJSON(
    serializer.toJSON(new PublicError('SERVER_NAME_CONFLICT')),
  )
  expect(getPublicErrorMessage(decoded, 'Unable to save.')).toBe(
    'Server names must be unique within a team.',
  )
  expect(
    getPublicErrorMessage(
      {
        name: 'PublicError',
        code: 'SERVER_NOT_FOUND',
        message: 'private diagnostics',
      },
      'Unable to save.',
    ),
  ).toBe('Server not found.')
})

test.each([
  new Error('Unexpected provider diagnostic'),
  { name: 'PublicError', code: 'UNRECOGNIZED', message: 'private' },
  { code: 'SERVER_NOT_FOUND', message: 'private' },
  new PublicError('INTERNAL_ERROR'),
])('unknown failures use the action fallback', (error) => {
  expect(getPublicErrorMessage(error, 'Unable to save.')).toBe(
    'Unable to save.',
  )
})

// Exercise the registry independently of transport; default Start transport is covered below.
test.each([
  'PROJECT_NAME_CONFLICT',
  'TEAM_LAST_OWNER',
  'ACCOUNT_LAST_SIGN_IN_METHOD',
  'BACKUP_STORAGE_IN_USE',
  'AVATAR_CONTENT_MISMATCH',
] as const)(
  'registered code %s survives transport without trusting remote message text',
  (code) => {
    const decoded = serializer.fromJSON(
      serializer.toJSON(new PublicError(code)),
    )
    expect(getPublicErrorMessage(decoded, 'Action failed.')).toBe(
      publicErrorMessages[code],
    )
  },
)

test('plain public errors survive Start default serialization without a custom adapter', async () => {
  const { publicErrorPayload } = await import('@/server/http/public-errors')
  const { defaultSerovalPlugins } = await import(
    require.resolve('@tanstack/router-core')
  )
  const conflict = new PublicError(
    'SETTINGS_CONFLICT',
    '/team/projects/renamed/settings',
  )
  const decoded = serializer.fromJSON(
    serializer.toJSON(publicErrorPayload(conflict), {
      plugins: defaultSerovalPlugins,
    }),
    { plugins: defaultSerovalPlugins },
  )
  expect(decoded).toEqual({
    name: 'PublicError',
    code: 'SETTINGS_CONFLICT',
    message: publicErrorMessages.SETTINGS_CONFLICT,
    reloadUrl: '/team/projects/renamed/settings',
  })
  expect(decoded).not.toBeInstanceOf(Error)
  expect(getPublicErrorMessage(decoded, 'Failed')).toBe(
    publicErrorMessages.SETTINGS_CONFLICT,
  )
})
