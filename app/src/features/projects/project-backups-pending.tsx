import type { ReactNode } from 'react'
import { ClockIcon, PlusIcon, EllipsisVerticalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'

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
        <ul className="scrollbar overflow-x-auto rounded-xl border bg-card text-card-foreground">
          <li className="flex h-11 min-w-[30rem] items-center gap-4 px-4 text-sm whitespace-nowrap">
            <Switch disabled aria-label="Policy enabled loading" />
            <Skeleton className="h-4 w-40" />

            <span className="flex shrink-0 items-center gap-2">
              <Skeleton className="size-2.5 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </span>
            <span className="hidden shrink-0 items-center gap-2 text-muted-foreground sm:flex">
              <ClockIcon className="size-4 shrink-0 opacity-50" />
              <Skeleton className="h-4 w-28" />
            </span>
            <div className="ml-auto shrink-0">
              <ButtonGroup className="-mr-2" aria-label="Backup policy actions">
                {canManage !== false ? (
                  <Button variant="outline" size="sm" disabled>
                    Run
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled
                  aria-label="Policy actions"
                >
                  <EllipsisVerticalIcon />
                </Button>
              </ButtonGroup>
            </div>
          </li>
        </ul>
      </section>
      <section className="space-y-4">
        <header className="flex h-8 items-center justify-between gap-x-4">
          <h2 className="text-base font-medium">Activity</h2>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          {[
            'All policies',
            'All types',
            'All environments',
            'All statuses',
            'All servers',
            'All dates',
          ].map((label) => (
            <Select disabled value="all" key={label}>
              <SelectTrigger aria-label={label}>
                <SelectValue>{label}</SelectValue>
              </SelectTrigger>
            </Select>
          ))}
        </div>
        <ul
          className="scrollbar overflow-x-auto rounded-xl border bg-card text-card-foreground"
          aria-label="Backup activity"
        >
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="flex h-11 min-w-[36rem] items-center gap-4 border-b px-4 text-sm whitespace-nowrap md:min-w-[52rem] last:border-b-0"
            >
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-14 shrink-0" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
              <span className="inline-flex items-center gap-2">
                <Skeleton className="size-2.5 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </span>
              <div className="ml-auto shrink-0">
                <ButtonGroup
                  className="-mr-2 shrink-0"
                  aria-label="Operation actions"
                >
                  {canManage !== false ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled
                      className="ml-auto shrink-0"
                      aria-label="Restore"
                    >
                      Restore
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled
                    aria-label="Operation actions loading"
                  >
                    <EllipsisVerticalIcon />
                  </Button>
                </ButtonGroup>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
