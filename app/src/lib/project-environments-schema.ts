import { z } from 'zod'

const projectEnvironmentSchema = z.object({
  id: z.string().trim().min(1),
  name: z
    .string()
    .trim()
    .min(1, 'Enter an environment name.')
    .max(255, 'Names must be 255 characters or fewer.'),
  slug: z
    .string()
    .trim()
    .min(2, 'Enter an identifier with at least two characters.')
    .max(255, 'Identifiers must be 255 characters or fewer.')
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
      'Environment identifiers can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.',
    ),
  branch: z
    .string()
    .trim()
    .min(1, 'Enter a branch pattern.')
    .max(255, 'Branch patterns must be 255 characters or fewer.'),
  color: z.string().trim().min(1).max(32),
  position: z.number().int().nonnegative(),
  status: z.enum(['active', 'deleted']),
})

export const projectEnvironmentsSchema = z.object({
  teamSlug: z.string().min(1),
  projectName: z.string().min(1),
  environments: z
    .array(projectEnvironmentSchema)
    .min(1, 'Production environment is required.')
    .superRefine((rows, ctx) => {
      const seen = new Set<string>()
      rows.forEach((row, index) => {
        if (row.status !== 'active') return
        if (seen.has(row.slug))
          ctx.addIssue({
            code: 'custom',
            path: [index, 'slug'],
            message: 'Environment identifiers must be unique.',
          })
        seen.add(row.slug)
      })
      if (!seen.has('production'))
        ctx.addIssue({
          code: 'custom',
          message: 'Production environment is required.',
        })
    }),
})
