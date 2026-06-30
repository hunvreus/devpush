import { ServerIcon, ServerOffIcon } from 'lucide-react'

import type { ResourceColor } from '@/components/resource-avatar'
import type { ServerStatus } from '@/server/servers/status'
import { ResourceIconAvatar } from '@/components/resource-avatar'
import { cn } from '@/lib/utils'

const statusColors: Record<ServerStatus, ResourceColor> = {
  disabled: 'rose',
  disconnected: 'neutral',
  connected: 'green',
  deleted: 'neutral',
  pending: 'amber',
}

const iconClasses = {
  xs: '[&>svg]:size-3 [&>svg]:stroke-2',
  sm: '[&>svg]:size-4 [&>svg]:stroke-2',
  md: '[&>svg]:size-6 [&>svg]:stroke-2',
  lg: '[&>svg]:size-9 [&>svg]:stroke-[1.25]',
  default: '[&>svg]:size-5 [&>svg]:stroke-2',
} as const

export function ServerAvatar({
  className,
  name,
  size = 'xs',
  status,
}: {
  className?: string
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'default'
  status: ServerStatus
}) {
  return (
    <ResourceIconAvatar
      color={statusColors[status]}
      icon={status === 'deleted' ? ServerOffIcon : ServerIcon}
      label={name}
      size={size}
      className={cn(iconClasses[size], className)}
    />
  )
}
