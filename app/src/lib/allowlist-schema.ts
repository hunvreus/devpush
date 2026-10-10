import { z } from 'zod'
import safeRegex from 'safe-regex2'

const emailSchema = z.string().email().max(320)
export function isValidAllowlistPattern(value: string) {
  return value.length <= 255 && safeRegex(value)
}
export const allowlistRuleSchema = z
  .object({
    type: z.enum(['email', 'domain', 'pattern']),
    value: z
      .string()
      .trim()
      .min(1, 'Enter an allowlist rule.')
      .max(255, 'Rules must be 255 characters or fewer.'),
  })
  .superRefine(({ type, value }, ctx) => {
    if (!value) return
    const valid =
      type === 'email'
        ? emailSchema.safeParse(value).success
        : type === 'domain'
          ? emailSchema.safeParse(`member@${value.replace(/^@/, '')}`).success
          : isValidAllowlistPattern(value)
    if (!valid)
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message:
          type === 'email'
            ? 'Enter a valid email address.'
            : type === 'domain'
              ? 'Enter a domain such as example.com, without a URL or path.'
              : 'Enter a valid regular expression without excessive repetition.',
      })
  })
  .transform(({ type, value }) => ({
    type,
    value:
      type === 'pattern'
        ? value
        : type === 'domain'
          ? value.toLowerCase().replace(/^@/, '')
          : value.toLowerCase(),
  }))

export function parseAllowlistEmails(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
}
export const allowlistImportSchema = z.object({
  emails: z
    .string()
    .trim()
    .min(1, 'Enter at least one email address.')
    .max(20_000, 'Import at most 20,000 characters at a time.')
    .superRefine((value, ctx) => {
      const emails = parseAllowlistEmails(value)
      if (!emails.length)
        ctx.addIssue({
          code: 'custom',
          message: 'Enter at least one email address.',
        })
      const invalid = emails.find(
        (email) => !emailSchema.safeParse(email).success,
      )
      if (invalid)
        ctx.addIssue({
          code: 'custom',
          message: `Invalid email address: ${invalid}.`,
        })
    }),
})
