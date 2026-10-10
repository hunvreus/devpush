import { lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'

import { NewProjectPending } from './new-project-pending'

const NewProjectDialogOverlay = lazy(() =>
  import('./new-project-dialog').then((module) => ({
    default: module.NewProjectDialogOverlay,
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

  return (
    <>
      {children(() => setOpen(true))}
      {open ? (
        <Suspense
          fallback={<NewProjectPending onClose={() => setOpen(false)} />}
        >
          <NewProjectDialogOverlay
            teamSlug={teamSlug}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  )
}
