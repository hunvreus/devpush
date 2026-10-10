import type { ReactNode } from 'react'
import {
  ClockIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EnvironmentDot } from './environment-dot'

export function ProjectBackupsPending({
  heading,
  canManage,
}: {
  heading: ReactNode
  canManage?: boolean
}) {
  return (
    <div className="space-y-8" aria-label="Loading backups" aria-busy="true">
      {heading}
      <section className="space-y-4">
        <header className="flex h-8 items-center justify-between gap-x-4">
          <h2 className="text-base font-medium">Policies</h2>
          {canManage !== false ? (
            <Button disabled>
              <PlusIcon data-icon="inline-start" />
              Create policy
            </Button>
          ) : null}
        </header>
        <ul className="overflow-x-auto rounded-xl border bg-card text-card-foreground">
          <li className="flex h-11 items-center gap-4 px-4 text-sm">
            <Skeleton className="size-4 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
              <ClockIcon className="size-4 shrink-0 opacity-50" />
              <Skeleton className="h-4 w-28" />
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <EnvironmentDot color="neutral" />
              <Skeleton className="h-4 w-20" />
            </span>
            <Button
              className="ml-auto shrink-0"
              variant="ghost"
              size="icon"
              disabled
              aria-label="Backup policy actions"
            >
              <MoreHorizontalIcon />
            </Button>
          </li>
        </ul>
      </section>
      <section className="space-y-4">
        <header className="flex h-8 items-center justify-between gap-x-4">
          <h2 className="text-base font-medium">Runs</h2>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          {[
            ['All environments', 'w-44'],
            ['All statuses', 'w-36'],
            ['All servers', 'w-36'],
            ['All dates', 'w-36'],
          ].map(([label, width]) => (
            <Select disabled key={label}>
              <SelectTrigger className={width} aria-label={label}>
                <SelectValue placeholder={label} />
              </SelectTrigger>
            </Select>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card text-card-foreground">
          <div className="grid min-h-12 min-w-256 grid-cols-[.8fr_1fr_1fr_1fr_1.4fr_1fr_6rem] gap-x-4 items-center border-b px-4 py-2 text-sm font-medium">
            {[
              'Status',
              'Environment',
              'Server',
              'Artifacts',
              'Started',
              'Latest restore',
              '',
            ].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="grid min-h-12 min-w-256 grid-cols-[.8fr_1fr_1fr_1fr_1.4fr_1fr_6rem] gap-x-4 items-center border-b px-4 py-2 text-sm last:border-b-0"
            >
              <span className="inline-flex items-center gap-2">
                <Skeleton className="size-4 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </span>
              <span className="inline-flex items-center gap-2">
                <EnvironmentDot color="neutral" />
                <Skeleton className="h-4 w-20" />
              </span>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-24" />
              {canManage !== false ? (
                <Button variant="outline" size="sm" disabled>
                  <RotateCcwIcon data-icon="inline-start" />
                  Restore
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
