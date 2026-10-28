import { z } from 'zod'

export const notificationCategories = [
  {
    id: 'deployments',
    label: 'Deployment alerts',
    description: 'Failed deployments and recovery after a failure.',
  },
  {
    id: 'backups',
    label: 'Backup and restore alerts',
    description:
      'Failed backups or restores, and recovery after a backup failure.',
  },
  {
    id: 'domains',
    label: 'Domain alerts',
    description: 'Domain verification failures and recovery.',
  },
  {
    id: 'servers',
    label: 'Server alerts',
    description: 'Disconnected servers, low disk space and recovery.',
  },
] as const
export type NotificationCategory = (typeof notificationCategories)[number]['id']
export const notificationPreferencesSchema = z.object({
  deployments: z.boolean(),
  backups: z.boolean(),
  domains: z.boolean(),
  servers: z.boolean(),
})
export const defaultNotificationPreferences = {
  deployments: true,
  backups: true,
  domains: true,
  servers: true,
}
export const notificationScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace'), id: z.string().min(1) }),
  z.object({ kind: z.literal('project'), id: z.string().min(1) }),
])
export type NotificationScope = z.infer<typeof notificationScopeSchema>
