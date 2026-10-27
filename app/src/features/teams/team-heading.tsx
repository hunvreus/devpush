import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { ResourceAvatar } from '#devpush/components/resource-avatar'

type HeadingTeam = {
  color?:
    | 'amber'
    | 'blue'
    | 'green'
    | 'neutral'
    | 'rose'
    | 'lime'
    | 'sky'
    | 'zinc'
  image?: string | null
  name: string
  slug: string
}

export function TeamHeading({
  actions,
  crumb,
  team,
}: {
  actions?: ReactNode
  crumb?: ReactNode
  team: HeadingTeam
}) {
  return (
    <header className="flex min-h-10 items-center justify-between gap-4">
      <h1 className="flex min-w-0 items-center gap-x-3 text-2xl font-medium">
        <Link
          className="shrink-0"
          to="/$teamSlug"
          params={{ teamSlug: team.slug }}
        >
          <ResourceAvatar
            name={team.name}
            src={team.image ?? undefined}
            color={team.color}
            size="md"
          />
        </Link>
        {crumb ? (
          <>
            <span className="text-muted-foreground/25 font-normal">/</span>
            {crumb}
          </>
        ) : (
          <span className="truncate">{team.name}</span>
        )}
      </h1>
      {actions}
    </header>
  )
}
