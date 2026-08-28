import { createFileRoute, redirect } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
    <Dialog open>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Select a repository, then confirm the initial deployment defaults.
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar -m-4 min-h-0 overflow-y-auto p-4">
          <div className="space-y-4">
            <RepositoryToolbarPending />
            <RepoListPending />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RepositoryToolbarPending() {
  return (
    <div className="flex gap-2">
      <Skeleton className="h-8 w-40 shrink-0 border border-input bg-muted/70 dark:bg-input/40" />
      <Skeleton className="h-8 min-w-0 flex-1 border border-input bg-muted/70 dark:bg-input/40" />
    </div>
  )
}

function RepoListPending() {
  return (
    <ul
      className="overflow-hidden rounded-lg border"
      role="listbox"
      aria-label="Loading repositories"
      aria-live="polite"
    >
      {Array.from({ length: 5 }).map((_, index) => (
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
