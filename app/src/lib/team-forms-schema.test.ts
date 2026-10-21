import { expect, test } from 'vitest'
import {
  createTeamSchema,
  bulkInviteSchema,
  parseInviteEmails,
} from './team-forms-schema'

test.each(['', ' ', 'x'.repeat(101)])('rejects invalid team names', (name) => {
  expect(createTeamSchema.safeParse({ settingsVersion: 1, teamId: 't', name }).success).toBe(
    false,
  )
})
test.each(['', ', ,', 'invalid', 'x'.repeat(20001)])(
  'rejects invalid complete invite lists',
  (emails) => {
    expect(
      bulkInviteSchema.safeParse({
        settingsVersion: 1, teamId: 't',
        teamSlug: 'team',
        role: 'member',
        emails,
      }).success,
    ).toBe(false)
  },
)
test('deduplicates normalized invite emails', () => {
  expect(
    parseInviteEmails('One@example.com, two@example.com\nONE@example.com'),
  ).toEqual(['one@example.com', 'two@example.com'])
})

test('ignores invalid addresses alongside valid addresses', () => {
  expect(
    parseInviteEmails('valid@example.com, invalid, VALID@example.com'),
  ).toEqual(['valid@example.com'])
  expect(
    bulkInviteSchema.safeParse({
      settingsVersion: 1, teamId: 't',
      teamSlug: 'team',
      role: 'member',
      emails: 'valid@example.com, invalid',
    }).success,
  ).toBe(true)
})
