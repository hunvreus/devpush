import { z } from 'zod'
import { envVarSchema } from './project-creation-schema'

export const projectEnvVarsSchema = z.object({
  teamSlug: z.string().min(1),
  projectName: z.string().min(1),
  envVars: z.array(envVarSchema).superRefine((rows, ctx) => {
    const seen = new Set<string>()
    rows.forEach((row, index) => {
      const key = JSON.stringify([row.environment || '', row.key])
      if (seen.has(key))
        ctx.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: 'Environment variable keys must be unique per environment.',
        })
      seen.add(key)
    })
  }),
})
