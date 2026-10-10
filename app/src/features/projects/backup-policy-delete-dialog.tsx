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
} from '@/components/ui/alert-dialog'
import { FieldError } from '@/components/ui/field'
import { getErrorMessage } from '@/lib/error-message'

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
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onDelete()
      onOpenChange(false)
    } catch (cause) {
      setError(
        getErrorMessage(
          cause,
          'Unable to delete backup policy. Please try again.',
        ),
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
          setError(null)
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
        <FieldError>{error}</FieldError>
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
