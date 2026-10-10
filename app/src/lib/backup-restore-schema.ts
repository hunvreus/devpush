import { z } from 'zod'

export const backupRestoreArtifactSchema = z.discriminatedUnion('type', [
  z.object({
    artifactId: z.string().min(1),
    type: z.literal('volume'),
    targetVolume: z
      .string()
      .trim()
      .min(1, 'Select a target volume.')
      .max(128, 'Volume names must be 128 characters or fewer.'),
  }),
  z.object({
    artifactId: z.string().min(1),
    type: z.literal('database'),
    targetService: z
      .string()
      .trim()
      .min(1, 'Select a target service.')
      .max(128, 'Service names must be 128 characters or fewer.'),
  }),
])
