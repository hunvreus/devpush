import { settingsVersionSchema } from '@/lib/settings-version'
import { z } from 'zod'

export const publicIdSchema = z.string().min(1).max(128)
export const publicTimestampSchema = z.iso.datetime()
export const publicPageInputSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(2048).optional(),
})
export const publicProjectInputSchema = z.strictObject({
  projectId: publicIdSchema,
})
export const publicDeploymentInputSchema = z.strictObject({
  deploymentId: publicIdSchema,
})
export const publicServerInputSchema = z.strictObject({
  serverId: publicIdSchema,
})
export const publicBackupInputSchema = z.strictObject({
  backupRunId: publicIdSchema,
})
export const publicProjectSchema = z.strictObject({
  id: publicIdSchema,
  teamId: publicIdSchema,
  name: z.string(),
  slug: z.string(),
  repository: z.string(),
  repositoryId: z.number().int().nullable(),
  defaultServerId: publicIdSchema.nullable(),
  settingsVersion: settingsVersionSchema,
  createdAt: publicTimestampSchema,
})
export const publicEnvironmentSchema = z.strictObject({
  id: publicIdSchema,
  projectId: publicIdSchema,
  name: z.string(),
  slug: z.string(),
  branch: z.string(),
  isProduction: z.boolean(),
  position: z.number().int(),
  color: z.string(),
  serverId: publicIdSchema.nullable(),
  createdAt: publicTimestampSchema,
})
export const publicDeploymentSchema = z.strictObject({
  id: publicIdSchema,
  projectId: publicIdSchema,
  environmentId: publicIdSchema,
  serverId: publicIdSchema,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
  phase: z.string().nullable(),
  trigger: z.enum(['user', 'webhook', 'api', 'rollback']),
  repository: z.string(),
  sha: z.string(),
  branch: z.string(),
  createdAt: publicTimestampSchema,
  startedAt: publicTimestampSchema.nullable(),
  finishedAt: publicTimestampSchema.nullable(),
})
export const publicServerSchema = z.strictObject({
  settingsVersion: settingsVersionSchema,
  id: publicIdSchema,
  teamId: publicIdSchema,
  name: z.string(),
  status: z.enum([
    'pending',
    'connected',
    'disconnected',
    'disabled',
    'deleted',
  ]),
  publicAddress: z.string().nullable(),
  agentVersion: z.string().nullable(),
  lastSeenAt: publicTimestampSchema.nullable(),
  createdAt: publicTimestampSchema,
})
export const publicBackupRunSchema = z.strictObject({
  id: publicIdSchema,
  projectId: publicIdSchema,
  environmentId: publicIdSchema,
  deploymentId: publicIdSchema.nullable(),
  serverId: publicIdSchema.nullable(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
  createdAt: publicTimestampSchema,
  startedAt: publicTimestampSchema.nullable(),
  finishedAt: publicTimestampSchema.nullable(),
})
const publicLogSchema = z.strictObject({
  position: z.number().int().nonnegative(),
  content: z.string().max(64 * 1024),
  createdAt: publicTimestampSchema,
  truncated: z.boolean(),
})
export const publicLogPageSchema = z.strictObject({
  items: z.array(publicLogSchema).max(100),
  nextCursor: z.string().nullable(),
  retentionMayHaveRemovedEarlierEntries: z.literal(true),
})
export function publicPageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  })
}
export const publicDeploymentAcceptedSchema = z.strictObject({
  deploymentId: publicIdSchema,
  statusUrl: z.string(),
})
export const publicBackupAcceptedSchema = z.strictObject({
  backupRunId: publicIdSchema,
  agentJobId: publicIdSchema,
  statusUrl: z.string(),
})
export const publicRestoreAcceptedSchema = z.strictObject({
  agentJobId: publicIdSchema,
  statusUrl: z.string(),
})
export const publicErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
})
