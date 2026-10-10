import { expect, test } from 'vitest'
import {
  createTeamSchema,
  bulkInviteSchema,
  parseInviteEmails,
} from './team-forms-schema'

test.each(['', ' ', 'x'.repeat(101)])('rejects invalid team names', (name) => {
  expect(createTeamSchema.safeParse({ name }).success).toBe(false)
})
test.each(['', ', ,', 'valid@example.com, invalid', 'x'.repeat(20001)])(
  'rejects invalid complete invite lists',
  (emails) => {
    expect(
      bulkInviteSchema.safeParse({ teamSlug: 'team', role: 'member', emails })
        .success,
    ).toBe(false)
  },
)
test('deduplicates normalized invite emails', () => {
  expect(
    parseInviteEmails('One@example.com, two@example.com\nONE@example.com'),
  ).toEqual(['one@example.com', 'two@example.com'])
})
