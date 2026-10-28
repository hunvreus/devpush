import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#devpush/components/ui/table'
import { Skeleton } from '#devpush/components/ui/skeleton'

export function PendingList({
  label,
  rows = 1,
}: {
  label: string
  rows?: number
}) {
  return (
    <div
      className="scrollbar overflow-x-auto rounded-xl border bg-card text-card-foreground"
      aria-label={label}
      aria-busy="true"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          className="flex h-11 min-w-[20rem] items-center gap-4 border-b px-4 last:border-b-0"
          key={index}
        >
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="h-4 w-32 shrink-0" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="-mr-2 size-8 shrink-0" />
        </div>
      ))}
    </div>
  )
}

export function PendingTable({
  label,
  columns,
  avatar = false,
  secondaryName = false,
}: {
  label: string
  columns: Array<{ title: string; className?: string }>
  avatar?: boolean
  secondaryName?: boolean
}) {
  return (
    <div
      className="scrollbar overflow-x-auto rounded-xl border bg-card text-card-foreground"
      aria-label={label}
      aria-busy="true"
    >
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column, index) => (
              <TableHead
                className={`${column.className ?? ''} first:pl-4 last:pr-4`}
                key={index}
              >
                {column.title || <span className="sr-only">Actions</span>}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            {columns.map((column, index) => (
              <TableCell
                className="first:pl-4 last:pr-4"
                key={index}
              >
                {column.title ? (
                  <div className="flex items-center gap-3">
                    {avatar && index === 0 ? (
                      <Skeleton className="size-8 shrink-0 rounded-full" />
                    ) : null}
                    {secondaryName && index === 0 ? (
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-24 max-w-full" />
                        <Skeleton className="h-4 w-16 max-w-full" />
                      </div>
                    ) : (
                      <Skeleton className="h-4 w-24 max-w-full" />
                    )}
                  </div>
                ) : (
                  <div className="ml-auto w-fit">
                    <Skeleton className="size-8" />
                  </div>
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
