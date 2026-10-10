import { z } from 'zod'

export const createTeamSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a team name.')
    .max(100, 'Team names must be 100 characters or fewer.'),
})
const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter an email address.')
  .email('Enter a valid email address.')
  .max(320, 'Email addresses must be 320 characters or fewer.')
export const inviteSchema = z.object({
  teamSlug: z.string().min(1),
  email: emailSchema,
  role: z.enum(['admin', 'member']),
})
export function parseInviteEmails(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
}
export const bulkInviteSchema = inviteSchema.omit({ email: true }).extend({
  emails: z
    .string()
    .trim()
    .min(1, 'Enter at least one email address.')
    .max(20000, 'Enter at most 20,000 characters at a time.')
    .superRefine((value, ctx) => {
      const emails = parseInviteEmails(value)
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
