import { z } from 'zod'
import { avatarDataUrlSchema } from '@/server/uploads/avatar-schema'
import type { FormErrors } from './form-errors'

export const teamGeneralSchema = z.object({
  teamSlug: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, 'Enter a team name.')
    .max(100, 'Team names must be 100 characters or fewer.'),
  slug: z
    .string()
    .trim()
    .min(2, 'Enter a slug with at least 2 characters.')
    .max(100, 'Slugs must be 100 characters or fewer.')
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
      'Use letters, numbers, dots, underscores, or hyphens. Start and end with a letter or number.',
    ),
  avatarDataUrl: avatarDataUrlSchema,
  deleteAvatar: z.boolean().optional(),
})

export function teamSettingsErrors(error: unknown): FormErrors | null {
  if (!(error instanceof Error)) return null
  if (error.message === 'Team name is required.')
    return { name: 'Enter a team name.' }
  if (
    [
      'This slug is reserved.',
      'A team with this slug already exists.',
    ].includes(error.message)
  )
    return { slug: error.message }
  if (
    [
      'Upload a PNG, JPEG, or WebP image.',
      'Avatars must be 2 MB or smaller.',
      'The uploaded file does not match its image type.',
    ].includes(error.message)
  )
    return { avatarDataUrl: error.message }
  return null
}
