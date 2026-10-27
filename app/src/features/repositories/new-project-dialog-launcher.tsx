import { lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'

import { Dialog, DialogContent } from '#devpush/components/ui/dialog'
import { NewProjectPendingContent } from './new-project-pending'

const NewProjectDialogOverlayContent = lazy(() =>
  import('./new-project-dialog').then((module) => ({
    default: module.NewProjectDialogOverlayContent,
  })),
)

export function NewProjectDialogLauncher({
  children,
  teamSlug,
}: {
  children: (open: () => void) => ReactNode
  teamSlug: string
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  return (
    <>
      {children(() => setOpen(true))}
      {open ? (
        <Dialog
          open
          onOpenChange={(nextOpen) => !nextOpen && !creating && setOpen(false)}
        >
          <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
            <Suspense fallback={<NewProjectPendingContent />}>
              <NewProjectDialogOverlayContent
                teamSlug={teamSlug}
                onPendingChange={setCreating}
                onCreated={() => setOpen(false)}
              />
            </Suspense>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
