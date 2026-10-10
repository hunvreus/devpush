import { expect, test } from 'vitest'
import {
  allowlistRuleSchema,
  allowlistImportSchema,
  parseAllowlistEmails,
} from './allowlist-schema'

test.each([
  { type: 'email', value: 'invalid' },
  { type: 'email', value: '' },
  { type: 'domain', value: 'https://example.com/path' },
  { type: 'domain', value: 'example..com' },
  { type: 'pattern', value: '[' },
  { type: 'pattern', value: '(a+)+' },
  { type: 'pattern', value: 'x'.repeat(256) },
])('rejects invalid rule $type/$value', (input) => {
  expect(allowlistRuleSchema.safeParse(input).success).toBe(false)
})
test('normalizes email/domain rules but preserves regex case', () => {
  expect(
    allowlistRuleSchema.parse({ type: 'email', value: ' User@Example.com ' })
      .value,
  ).toBe('user@example.com')
  expect(
    allowlistRuleSchema.parse({ type: 'domain', value: ' @Example.com ' })
      .value,
  ).toBe('example.com')
  expect(
    allowlistRuleSchema.parse({
      type: 'pattern',
      value: ' ^User@Example\\.com$ ',
    }).value,
  ).toBe('^User@Example\\.com$')
})
test('imports normalize and deduplicate all supported separators', () => {
  const parsed = allowlistImportSchema.parse({
    emails: 'One@example.com, two@example.com\nONE@example.com',
  })
  expect(parseAllowlistEmails(parsed.emails)).toEqual([
    'one@example.com',
    'two@example.com',
  ])
})
test.each(['', ', ,', 'valid@example.com, invalid', 'x'.repeat(20001)])(
  'rejects an invalid complete import',
  (emails) => {
    expect(allowlistImportSchema.safeParse({ emails }).success).toBe(false)
  },
)
