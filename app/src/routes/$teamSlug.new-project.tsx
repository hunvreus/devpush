import { createFileRoute, redirect } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { NewProjectDialog } from '@/features/repositories/new-project-dialog'
import { getNewProjectContext } from '@/server/projects/functions'

export const Route = createFileRoute('/$teamSlug/new-project')({
  loader: async ({ params }) => {
    const context = await getNewProjectContext({
      data: { teamSlug: params.teamSlug },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  pendingComponent: NewProjectPending,
  component: NewProjectRoute,
})

function NewProjectRoute() {
  const context = Route.useLoaderData()

  return (
    <NewProjectDialog
      team={context.team}
      servers={context.servers}
      repositorySelection={context.repositorySelection}
    />
  )
}

function NewProjectPending() {
  return (
    <div className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
      <div className="grid w-full max-w-[calc(100%-2rem)] gap-6 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 sm:max-w-2xl">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="scrollbar max-h-[calc(85vh-9rem)] overflow-y-auto pr-2">
          <div className="space-y-4">
            <RepositoryToolbarPending />
            <RepoListPending />
          </div>
        </div>
      </div>
    </div>
  )
}

function RepositoryToolbarPending() {
  return (
    <div className="flex gap-2">
      <Skeleton className="h-9 w-40 shrink-0 border border-input bg-muted/70 shadow-xs dark:bg-input/40" />
      <Skeleton className="h-9 min-w-0 flex-1 border border-input bg-muted/70 shadow-xs dark:bg-input/40" />
    </div>
  )
}

function RepoListPending() {
  return (
    <ul
      className="h-55"
      role="listbox"
      aria-label="Loading repositories"
      aria-live="polite"
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <li
          className={`flex h-12 items-center justify-between gap-x-2 border px-4 text-sm transition-colors hover:bg-muted/50 ${
            index > 0 ? 'border-t-0' : 'rounded-t-lg'
          } ${index === 4 ? 'rounded-b-lg' : ''}`}
          key={index}
          role="option"
          aria-disabled="true"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Skeleton className="h-4 w-32 rounded bg-muted-foreground/20" />
            <Skeleton className="h-4 w-24 rounded bg-muted-foreground/20" />
          </span>
          <Button disabled type="button">
            Select
          </Button>
        </li>
      ))}
    </ul>
  )
}
