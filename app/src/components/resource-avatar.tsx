import type { ComponentType, SVGProps } from 'react'

import { cn } from '@/lib/utils'

const sizeClasses = {
  xs: 'size-5 rounded text-xs font-semibold',
  sm: 'size-6 rounded-md text-sm font-semibold',
  md: 'size-10 rounded-lg text-xl font-medium',
  lg: 'size-14 rounded-xl text-4xl font-medium',
  default: 'size-8 rounded-lg text-lg font-semibold',
} as const

const colorClasses = {
  amber:
    'from-amber-100 to-amber-100/50 border-amber-200 text-amber-500 dark:from-amber-950/50 dark:to-amber-950 dark:border-amber-900',
  blue: 'from-blue-100 to-blue-100/50 border-blue-200 text-blue-500 dark:from-blue-950/50 dark:to-blue-950 dark:border-blue-900',
  green:
    'from-green-100 to-green-100/50 border-green-200 text-green-500 dark:from-green-950/50 dark:to-green-950 dark:border-green-900',
  neutral:
    'from-neutral-100 to-neutral-100/50 border-neutral-200 text-neutral-500 dark:from-neutral-800/70 dark:to-neutral-900 dark:border-neutral-700 dark:text-neutral-400',
  rose: 'from-rose-100 to-rose-100/50 border-rose-200 text-rose-500 dark:from-rose-950/50 dark:to-rose-950 dark:border-rose-900',
  lime: 'from-lime-100 to-lime-100/50 border-lime-200 text-lime-500 dark:from-lime-950/50 dark:to-lime-950 dark:border-lime-900',
  sky: 'from-sky-100 to-sky-100/50 border-sky-200 text-sky-500 dark:from-sky-950/50 dark:to-sky-950 dark:border-sky-900',
  zinc: 'from-zinc-100 to-zinc-100/50 border-zinc-200 text-zinc-500 dark:from-zinc-950/50 dark:to-zinc-950 dark:border-zinc-900',
} as const

const iconSizeClasses = {
  xs: '[&>svg]:size-3',
  sm: '[&>svg]:size-4',
  md: '[&>svg]:size-6',
  lg: '[&>svg]:size-9 [&>svg]:stroke-[1.25]',
  default: '[&>svg]:size-5',
} as const

export type ResourceColor = keyof typeof colorClasses

type ResourceAvatarProps = {
  name: string
  src?: string
  color?: ResourceColor
  size?: keyof typeof sizeClasses
  className?: string
}

export function ResourceAvatar({
  name,
  src,
  color = 'zinc',
  size = 'default',
  className,
}: ResourceAvatarProps) {
  const initial = name.trim().charAt(0).toLocaleUpperCase()

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('shrink-0 object-cover', sizeClasses[size], className)}
      />
    )
  }

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center border bg-gradient-to-tl uppercase',
        sizeClasses[size],
        colorClasses[color],
        className,
      )}
    >
      {initial}
    </span>
  )
}

export function ResourceIconAvatar({
  className,
  color = 'zinc',
  icon: Icon,
  label,
  size = 'default',
}: {
  className?: string
  color?: ResourceColor
  icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
  size?: keyof typeof sizeClasses
}) {
  return (
    <span
      aria-label={label}
      className={cn(
        'flex shrink-0 items-center justify-center border bg-gradient-to-tl [&>svg]:shrink-0',
        sizeClasses[size],
        iconSizeClasses[size],
        colorClasses[color],
        className,
      )}
    >
      <Icon data-preserve-color />
    </span>
  )
}
