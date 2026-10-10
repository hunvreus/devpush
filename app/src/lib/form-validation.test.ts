import { expect, test } from 'vitest'
import { teamGeneralSchema, teamSettingsErrors } from './team-settings-schema'
import { serverNameSchema } from './server-name-schema'
import { formErrors } from './form-errors'

test('team constraints preserve per-field errors including image validation', () => {
  const result = teamGeneralSchema.safeParse({
    teamSlug: 'team',
    name: ' ',
    slug: '-bad',
    avatarDataUrl: 'data:image/gif;base64,AAAA',
  })
  if (result.success) throw new Error('Expected invalid fields')
  expect(Object.keys(formErrors(result.error.issues)).sort()).toEqual([
    'avatarDataUrl',
    'name',
    'slug',
  ])
})
test.each(['a', '', '   ', '-host', 'host-', 'a b', 'a'.repeat(101)])(
  'rejects invalid server name %s',
  (name) => {
    expect(serverNameSchema.safeParse(name).success).toBe(false)
  },
)
test('normalizes a valid server name and supports permitted characters', () => {
  expect(serverNameSchema.parse(' host_1.us-east ')).toBe('host_1.us-east')
})
test('only known business errors are treated as field errors', () => {
  expect(teamSettingsErrors(new Error('This slug is reserved.'))).toEqual({
    slug: 'This slug is reserved.',
  })
  expect(teamSettingsErrors(new Error('SQLITE_BUSY'))).toBeNull()
})
test('nested row issues retain their paths and first messages', () => {
  expect(
    formErrors([
      { path: ['routes', 1, 'port'], message: 'Invalid port' },
      { path: ['routes', 1, 'port'], message: 'Other' },
    ]),
  ).toEqual({ 'routes.1.port': 'Invalid port' })
})
