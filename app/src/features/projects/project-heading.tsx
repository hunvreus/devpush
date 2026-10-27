import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { ResourceAvatar } from '#devpush/components/resource-avatar'
import { cn } from '#devpush/lib/utils'

type HeadingProject = {
  avatarUrl?: string | null
  color?:
    | 'amber'
    | 'blue'
    | 'green'
    | 'neutral'
    | 'rose'
    | 'lime'
    | 'sky'
    | 'zinc'
  name: string
}

export function ProjectHeading({
  actions,
  className,
  crumbs = [],
  project,
  teamSlug,
}: {
  actions?: ReactNode
  className?: string
  crumbs?: Array<ReactNode>
  project: HeadingProject
  teamSlug: string
}) {
  return (
    <header
      className={cn(
        'flex min-h-10 items-start justify-between gap-4',
        className,
      )}
    >
      <h1 className="flex min-w-0 items-center gap-x-3 text-2xl font-medium">
        <Link
          className="shrink-0"
          to="/$teamSlug/projects/$projectName"
          params={{ teamSlug, projectName: project.name }}
        >
          <ResourceAvatar
            name={project.name}
            src={project.avatarUrl ?? undefined}
            color={project.color}
            size="md"
          />
        </Link>
        {crumbs.length === 0 ? (
          <span className="truncate">{project.name}</span>
        ) : (
          crumbs.map((crumb, index) => (
            <span className="contents" key={index}>
              <span className="text-muted-foreground/25 font-normal">/</span>
              {crumb}
            </span>
          ))
        )}
      </h1>
      {actions}
    </header>
  )
}
