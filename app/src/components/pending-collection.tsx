import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

export function PendingList({
  label,
  rows = 1,
}: {
  label: string
  rows?: number
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border bg-card text-card-foreground"
      aria-label={label}
      aria-busy="true"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          className="flex h-11 items-center gap-4 border-b px-4 last:border-b-0"
          key={index}
        >
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="h-4 min-w-0 flex-1" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="size-8 shrink-0" />
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
      className="overflow-hidden rounded-xl border bg-card text-card-foreground"
      aria-label={label}
      aria-busy="true"
    >
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column, index) => (
              <TableHead className={column.className} key={index}>
                {column.title || <span className="sr-only">Actions</span>}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            {columns.map((column, index) => (
              <TableCell key={index}>
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
                  <Skeleton className="ml-auto size-8" />
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
