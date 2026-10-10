import { z } from 'zod'
import { avatarDataUrlSchema } from '@/server/uploads/avatar-schema'

export const accountSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(256, 'Name must be 256 characters or fewer.'),
  username: z
    .string()
    .trim()
    .min(1, 'Enter a username.')
    .max(50, 'Username must be 50 characters or fewer.')
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
      'Username must start and end with a letter or number and only use letters, numbers, dots, underscores, or hyphens.',
    ),
  avatarDataUrl: avatarDataUrlSchema,
  deleteAvatar: z.boolean().optional(),
})
export type AccountSettingsErrors = Partial<
  Record<'name' | 'username' | 'avatarDataUrl' | 'form', string>
>

export function accountValidationErrors(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): AccountSettingsErrors {
  const errors: AccountSettingsErrors = {}
  for (const issue of issues) {
    const field = issue.path[0]
    const key =
      field === 'name' || field === 'username' || field === 'avatarDataUrl'
        ? field
        : 'form'
    errors[key] ??= issue.message
  }
  return errors
}

export function accountServiceErrors(
  error: unknown,
): AccountSettingsErrors | null {
  if (!(error instanceof Error)) return null
  if (error.message === 'Name is required.') return { name: 'Enter your name.' }
  if (error.message.startsWith('Username ')) return { username: error.message }
  if (
    [
      'Upload a PNG, JPEG, or WebP image.',
      'Avatars must be 2 MB or smaller.',
      'The uploaded file does not match its image type.',
    ].includes(error.message)
  ) {
    return { avatarDataUrl: error.message }
  }
  return null
}

export const accountEmailSchema = z.object({
  newEmail: z
    .string()
    .trim()
    .min(1, 'Enter an email address.')
    .email('Enter a valid email address.')
    .max(320, 'Email addresses must be 320 characters or fewer.')
    .transform((email) => email.toLowerCase()),
})
