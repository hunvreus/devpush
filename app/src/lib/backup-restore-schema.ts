import { z } from 'zod'
import { backupResourceNameSchema } from './backup-resource-schema'

export const backupRestoreArtifactSchema = z.discriminatedUnion('type', [
  z.object({
    artifactId: z.string().min(1),
    type: z.literal('volume'),
    targetVolume: backupResourceNameSchema,
  }),
  z.object({
    artifactId: z.string().min(1),
    type: z.literal('database'),
    targetService: backupResourceNameSchema,
  }),
])
