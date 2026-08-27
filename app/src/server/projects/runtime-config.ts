import { z } from 'zod'

const composeRuntimeConfigSchema = z.strictObject({
  type: z.literal('compose'),
  path: z.string().trim().min(1).max(255).nullable(),
  releaseCommand: z.string().trim().nullable(),
  releaseService: z.string().trim().min(1).nullable(),
  readinessPath: z
    .string()
    .trim()
    .regex(/^\//, 'Readiness paths must start with /.')
    .nullable(),
  deployCommand: z.string().trim().nullable(),
  rollbackCommand: z.string().trim().nullable(),
  timeoutSeconds: z.number().int().min(60).max(7200),
})

export const projectRuntimeConfigSchema = composeRuntimeConfigSchema

export type ComposeRuntimeConfig = z.infer<typeof composeRuntimeConfigSchema>

// Add future runtime kinds as new members of this discriminated union.
export type ProjectRuntimeConfig = ComposeRuntimeConfig

export function createComposeRuntimeConfig(
  overrides: Partial<Omit<ComposeRuntimeConfig, 'type'>> = {},
): ComposeRuntimeConfig {
  return {
    type: 'compose',
    path: null,
    releaseCommand: null,
    releaseService: null,
    readinessPath: null,
    deployCommand: null,
    rollbackCommand: null,
    timeoutSeconds: 1800,
    ...overrides,
  }
}

export function parseProjectRuntimeConfig(
  value: unknown,
): ProjectRuntimeConfig | null {
  const result = projectRuntimeConfigSchema.safeParse(value)
  return result.success ? result.data : null
}

export function requireProjectRuntimeConfig(
  value: unknown,
): ProjectRuntimeConfig {
  const config = parseProjectRuntimeConfig(value)
  if (!config) {
    throw new Error('Project runtime configuration is invalid.')
  }
  return config
}
