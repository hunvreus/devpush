import { PublicError } from '#devpush/lib/public-error'
import { z } from 'zod'

export const maxLifecycleCommandLength = 16 * 1024

const lifecycleCommandSchema = z
  .string()
  .trim()
  .max(
    maxLifecycleCommandLength,
    'Commands must be 16,384 characters or fewer.',
  )
  .nullable()

export const repositoryComposePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(255, 'Compose paths must be 255 characters or fewer.')
  .refine(isRepositoryRelativePath, {
    message: 'Compose paths must stay within the repository.',
  })

const composeRuntimeConfigSchema = z.strictObject({
  type: z.literal('compose'),
  path: repositoryComposePathSchema.nullable(),
  releaseCommand: lifecycleCommandSchema,
  releaseService: z.string().trim().min(1).nullable(),
  readinessPath: z
    .string()
    .trim()
    .regex(/^\//, 'Readiness paths must start with /.')
    .nullable(),
  deployCommand: lifecycleCommandSchema,
  rollbackCommand: lifecycleCommandSchema,
  timeoutSeconds: z
    .number()
    .int('Enter a whole number of seconds.')
    .min(60, 'Timeout must be at least 60 seconds.')
    .max(7200, 'Timeout must be 7,200 seconds or fewer.'),
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
    throw new PublicError('PROJECT_RUNTIME_CONFIG_INVALID')
  }
  return config
}

function isRepositoryRelativePath(value: string) {
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    return false
  }

  const segments = value.split('/')
  return segments.every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..',
  )
}

export function hostLifecycleCommandsChanged(
  current: ProjectRuntimeConfig,
  next: ProjectRuntimeConfig,
) {
  return (
    current.deployCommand !== next.deployCommand ||
    current.rollbackCommand !== next.rollbackCommand
  )
}

export function hostLifecycleCommandsUseChangedSource({
  currentRepoFullName,
  currentRuntimeConfig,
  nextRepoFullName,
  nextRuntimeConfig,
}: {
  currentRepoFullName: string
  currentRuntimeConfig: ProjectRuntimeConfig
  nextRepoFullName: string
  nextRuntimeConfig: ProjectRuntimeConfig
}) {
  const hasHostCommand = Boolean(
    nextRuntimeConfig.deployCommand || nextRuntimeConfig.rollbackCommand,
  )

  return (
    hasHostCommand &&
    (nextRepoFullName !== currentRepoFullName ||
      nextRuntimeConfig.path !== currentRuntimeConfig.path)
  )
}
