import { z } from 'zod'

import { decryptSecret, encryptSecret } from '#devpush/server/secrets/crypto'
import type { ProjectEnvironmentVariable } from './types'

const projectEnvironmentVariablesSchema = z.array(
  z.object({
    environment: z.string().optional(),
    key: z.string(),
    value: z.string(),
  }),
)

export function encryptProjectEnvVars(
  envVars: Array<ProjectEnvironmentVariable>,
) {
  return encryptSecret(JSON.stringify(envVars))
}

export function readProjectEnvVars(project: {
  envVarsEncrypted: string | null
}) {
  if (!project.envVarsEncrypted) return []

  return projectEnvironmentVariablesSchema.parse(
    JSON.parse(decryptSecret(project.envVarsEncrypted)),
  )
}
