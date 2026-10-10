import { z } from 'zod'
import { projectMachineNameSchema } from './project-settings-schema'
import {
  maxLifecycleCommandLength,
  repositoryComposePathSchema,
} from '@/server/projects/runtime-config'

export const envVarSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Enter a variable key.')
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      'Environment variable keys must use shell-compatible names.',
    ),
  value: z.string(),
  environment: z.string().trim().optional(),
})

export const createProjectSchema = z.object({
  teamSlug: z.string().min(1),
  installationId: z.number().int().positive(),
  serverId: z.string().trim().optional().nullable(),
  composePath: repositoryComposePathSchema.or(z.literal('')).optional(),
  readinessPath: z
    .string()
    .trim()
    .refine((value) => !value || value.startsWith('/'), {
      message: 'Health check paths must start with /.',
    })
    .optional(),
  releaseCommand: z
    .string()
    .trim()
    .max(
      maxLifecycleCommandLength,
      'Commands must be 16,384 characters or fewer.',
    )
    .optional(),
  releaseService: z.string().trim().optional(),
  envVars: z
    .array(envVarSchema)
    .superRefine((rows, ctx) => {
      const keys = new Set<string>()
      rows.forEach((row, index) => {
        const key = JSON.stringify([row.environment || 'production', row.key])
        if (keys.has(key))
          ctx.addIssue({
            code: 'custom',
            path: [index, 'key'],
            message:
              'Environment variable keys must be unique per environment.',
          })
        keys.add(key)
      })
    })
    .optional(),
  projectName: projectMachineNameSchema,
  repoFullName: z
    .string()
    .min(1)
    .regex(/^[^/\s]+\/[^/\s]+$/, 'Select a valid GitHub repository.'),
})
