import { useParams, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  RepositoryListPending,
  RepositoryToolbarPending,
} from './repository-list-pending'

export function NewProjectPending({ onClose }: { onClose?: () => void } = {}) {
  const router = useRouter()
  const params = useParams({ strict: false })
  function close() {
    if (onClose) return onClose()
    if (typeof params.teamSlug !== 'string') return
    void router
      .navigate({ to: '/$teamSlug', params: { teamSlug: params.teamSlug } })
      .catch(() =>
        toast.error('Unable to close project creation. Please try again.'),
      )
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
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
            <RepositoryListPending />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
