import { ChevronsUpDownIcon, GithubIcon, SearchIcon } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'
import { Button } from '#devpush/components/ui/button'
import { Skeleton } from '#devpush/components/ui/skeleton'

export function RepositoryToolbarPending() {
  return (
    <div className="flex gap-2">
      <Button
        className="w-40 shrink-0 justify-start gap-1.5"
        variant="outline"
        disabled
      >
        <GithubIcon data-icon="inline-start" />
        <span className="min-w-0 flex-1 truncate text-left">GitHub</span>
        <ChevronsUpDownIcon data-icon="inline-end" />
      </Button>
      <InputGroup className="h-8 flex-1">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search by name" disabled />
      </InputGroup>
    </div>
  )
}

export function RepositoryListPending() {
  return (
    <ul
      className="overflow-hidden rounded-lg border"
      role="listbox"
      aria-label="Loading repositories"
      aria-live="polite"
      aria-busy="true"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <li
          className="flex h-11 items-center justify-between gap-x-2 border-b px-4 text-sm last:border-b-0"
          key={index}
          role="option"
          aria-disabled="true"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Skeleton className="h-4 w-32 rounded bg-muted-foreground/20" />
            <Skeleton className="h-4 w-24 rounded bg-muted-foreground/20" />
          </span>
          <Button disabled size="xs" type="button">
            Select
          </Button>
        </li>
      ))}
    </ul>
  )
}
