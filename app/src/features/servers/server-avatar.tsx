import { ServerIcon, ServerOffIcon } from 'lucide-react'

import type { ServerStatus } from '@/server/servers/status'
import { cn } from '@/lib/utils'

const statusTextColors: Record<ServerStatus, string> = {
  disabled: 'text-destructive',
  disconnected: 'text-destructive',
  connected: 'text-success',
  deleted: 'text-muted-foreground',
  pending: 'text-amber-500',
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
  const Icon =
    status === 'disabled' || status === 'disconnected' || status === 'deleted'
      ? ServerOffIcon
      : ServerIcon

  return (
    <span
      aria-label={name}
      role="img"
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        iconClasses[size],
        statusTextColors[status],
        className,
      )}
    >
      <Icon className="shrink-0" />
    </span>
  )
}
