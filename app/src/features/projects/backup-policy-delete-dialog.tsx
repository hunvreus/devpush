import { mutationErrorOptions } from '#devpush/lib/action-feedback'
import { toast } from 'sonner'
import { showSettingsConflict } from '#devpush/lib/settings-conflict'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#devpush/components/ui/alert-dialog'
import { getPublicErrorMessage } from '#devpush/lib/public-error'

export function BackupPolicyDeleteDialog({
  name,
  open,
  onOpenChange,
  onDelete,
}: {
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  async function submit() {
    if (pending) return
    setPending(true)

    try {
      await onDelete()
      onOpenChange(false)
    } catch (cause) {
      if (showSettingsConflict(cause)) return
      toast.error(
        getPublicErrorMessage(
          cause,
          'Unable to delete backup policy. Please try again.',
        ),
        ...mutationErrorOptions(cause),
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          onOpenChange(next)
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the backup policy and stops its scheduled backups.
            Existing backup runs are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            Delete policy
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
