import { settingsVersionSchema } from '#devpush/lib/settings-version'
import { z } from 'zod'
import { avatarDataUrlSchema } from '#devpush/lib/avatar-schema'
import { projectRuntimeConfigSchema } from '#devpush/lib/project-runtime-config'
import { formErrors } from './form-errors'
import type { FormErrors } from './form-errors'

export const projectMachineNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter a project name with at least 2 characters.')
  .max(100, 'Project names must be 100 characters or fewer.')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
    'Project names must start and end with a letter or number and only use letters, numbers, dots, underscores, or hyphens.',
  )

export const projectSettingsSchema = z.object({
  settingsVersion: settingsVersionSchema,
  projectId: z.string().min(1),
  section: z.enum(['general', 'build']),
  teamSlug: z.string().min(1),
  currentProjectName: z.string().min(1),
  projectName: projectMachineNameSchema,
  repoFullName: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, 'Select a valid GitHub repository.'),
  installationId: z.number().int().positive().nullable(),
  avatarDataUrl: avatarDataUrlSchema,
  deleteAvatar: z.boolean().optional(),
  runtimeConfig: projectRuntimeConfigSchema,
})

export function projectSettingsErrors(error: unknown): FormErrors | null {
  if (!(error instanceof Error)) return null
  if (error.message === 'Project names must be unique within a team.')
    return { projectName: error.message }
  if (
    [
      'Upload a PNG, JPEG, or WebP image.',
      'Avatars must be 2 MB or smaller.',
      'The uploaded file does not match its image type.',
    ].includes(error.message)
  )
    return { avatarDataUrl: error.message }
  if (
    [
      'Select a GitHub App installation for this repository.',
      'Connect GitHub before changing the repository.',
      'Install the GitHub app for this repository to continue.',
      'You need push access to use this repository.',
    ].includes(error.message)
  )
    return { repoFullName: error.message }
  return null
}

export function projectValidationErrors(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): FormErrors {
  const errors = formErrors(issues)
  if (errors.installationId) {
    errors.repoFullName ??=
      'Select a valid GitHub App installation for this repository.'
    delete errors.installationId
  }
  for (const key of ['teamSlug', 'currentProjectName']) {
    if (errors[key]) {
      errors.form ??=
        'This project could not be identified. Reload the page and try again.'
      delete errors[key]
    }
  }
  return errors
}
