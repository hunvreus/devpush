import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  RepositoryListPending,
  RepositoryToolbarPending,
} from './repository-list-pending'

export function NewProjectPendingContent() {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Create project</DialogTitle>
        <DialogDescription>
          Select a repository, then confirm the initial deployment defaults.
        </DialogDescription>
      </DialogHeader>
      <div className="scrollbar -m-4 min-h-0 overflow-y-auto p-4">
        <div className="space-y-4">
          <RepositoryToolbarPending />
          <RepositoryListPending />
        </div>
      </div>
    </>
  )
}
