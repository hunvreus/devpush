import { z } from 'zod'
import type { TeamRole } from '@/lib/team-role'
import type { ResourceColor } from '@/server/resources/color'

export const apiScopeDefinitions = {
  'projects:read': { minimumRole: 'member', label: 'Read projects' },
  'servers:read': { minimumRole: 'member', label: 'Read servers' },
  'deployments:read': { minimumRole: 'member', label: 'Read deployments' },
  'logs:read': {
    minimumRole: 'member',
    label: 'Read deployment and operation logs',
  },
  'backups:read': { minimumRole: 'member', label: 'Read backups' },
  'deployments:write': {
    minimumRole: 'member',
    label: 'Deploy, redeploy and roll back',
  },
  'projects:write': {
    minimumRole: 'member',
    label: 'Manage project configuration',
  },
  'secrets:write': {
    minimumRole: 'member',
    label: 'Write environment variables',
  },
  'backups:write': {
    minimumRole: 'admin',
    label: 'Run and configure backups',
  },
  'servers:write': { minimumRole: 'admin', label: 'Manage servers' },
  'backups:restore': { minimumRole: 'admin', label: 'Restore backups' },
  'projects:host-commands': {
    minimumRole: 'admin',
    label: 'Manage host lifecycle commands',
  },
} as const satisfies Record<string, { minimumRole: TeamRole; label: string }>

export type ApiScope = keyof typeof apiScopeDefinitions
export const apiKeyPresetSchema = z.enum(['read', 'deploy', 'manage'])
export type ApiKeyPreset = z.infer<typeof apiKeyPresetSchema>

export const apiKeyExpirationOptions = [
  { value: '1', label: '1 day', days: 1 },
  { value: '7', label: '7 days', days: 7 },
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: '180', label: '180 days', days: 180 },
  { value: '365', label: '1 year', days: 365 },
  { value: 'never', label: 'Never expires', days: null },
] as const
export const apiKeyMaxExpirationDays = Math.max(
  ...apiKeyExpirationOptions.map(({ days }) => days ?? 0),
)

const readScopes = Object.keys(apiScopeDefinitions).filter(
  (scope) => scope.endsWith(':read') && scope !== 'logs:read',
) as ApiScope[]
export const apiKeyPresets: Record<
  ApiKeyPreset,
  { label: string; description: string; scopes: ApiScope[] }
> = {
  read: {
    label: 'Read only',
    description: 'Read projects, servers, deployments and backups.',
    scopes: readScopes,
  },
  deploy: {
    label: 'Deploy',
    description: 'Read resources and deploy, redeploy or roll back projects.',
    scopes: [...readScopes, 'deployments:write'],
  },
  manage: {
    label: 'Manage',
    description: 'Manage resources within your current team permissions.',
    scopes: Object.keys(apiScopeDefinitions).filter(
      (scope) => scope !== 'logs:read',
    ) as ApiScope[],
  },
}

export const apiRoleRank: Record<TeamRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
}

export function scopesForApiPreset(
  preset: ApiKeyPreset,
  role: TeamRole,
  includeLogs = false,
): ApiScope[] {
  return [
    ...apiKeyPresets[preset].scopes,
    ...(includeLogs ? ['logs:read' as const] : []),
  ].filter(
    (scope) =>
      apiRoleRank[role] >= apiRoleRank[apiScopeDefinitions[scope].minimumRole],
  )
}

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    teamId: z.string().min(1).max(128),
    projectIds: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(100)
      .nullable()
      .default(null),
    preset: apiKeyPresetSchema.default('read'),
    includeLogs: z.boolean().default(false),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(apiKeyMaxExpirationDays)
      .nullable()
      .default(30),
  })
  .strict()
  .refine(
    (input) =>
      input.projectIds === null ||
      new Set(input.projectIds).size === input.projectIds.length,
    { path: ['projectIds'], message: 'Select each project only once.' },
  )

export const apiKeyIdSchema = z
  .object({ id: z.string().min(1).max(128) })
  .strict()

export const apiKeySettingsSchema = z
  .object({ page: z.number().int().min(1).max(1_000_000).default(1) })
  .strict()

export const apiKeyTeamsSchema = apiKeySettingsSchema.extend({
  query: z.string().trim().max(100).default(''),
})
export const apiKeyProjectsSchema = apiKeyTeamsSchema.extend({
  teamId: z.string().min(1).max(128),
})

export type ApiKeySummary = {
  id: string
  name: string
  prefix: string
  teamId: string
  teamName: string
  projectIds: string[] | null
  preset: ApiKeyPreset
  scopes: ApiScope[]
  status: 'active' | 'expired' | 'revoked' | 'unavailable'
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
}

export type ApiKeyTeamOption = {
  id: string
  name: string
  slug: string
  role: TeamRole
  image: string | null
  color: ResourceColor
  projects: ApiKeyProjectOption[]
}

export type ApiKeyProjectOption = {
  id: string
  name: string
  slug: string
  avatarUrl: string | null
  color: ResourceColor
}
