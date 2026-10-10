import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LoaderIcon, PencilIcon, PlusIcon, HardDriveIcon } from 'lucide-react'
import { toast } from 'sonner'
import { SettingsSection } from '@/components/settings-layout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty'
import { backupStorageSchema } from '@/lib/backup-storage-schema'
import type { BackupStorageSummary } from '@/lib/backup-storage-schema'
import { canManageTeamSettings } from '@/lib/team-role'
import type { TeamSummary } from '@/server/teams/types'
import {
  saveBackupStorageAction,
  deleteBackupStorageAction,
} from '@/server/backups/storage-functions'
import { getErrorMessage } from '@/lib/error-message'
import { formErrors } from '@/lib/form-errors'
import type { FormErrors } from '@/lib/form-errors'

export function BackupStorageSettings({
  team,
  storage,
}: {
  team: TeamSummary
  storage: BackupStorageSummary[]
}) {
  const canManage = canManageTeamSettings(team.role)
  const queryClient = useQueryClient()
  const [rows, setRows] = useState(storage)
  const [editing, setEditing] = useState<BackupStorageSummary | 'new' | null>(
    null,
  )
  const [removing, setRemoving] = useState<BackupStorageSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  async function refreshRows(next: BackupStorageSummary[]) {
    setRows(next)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['team-context', team.slug] }),
      queryClient.invalidateQueries({
        queryKey: ['project-context', team.slug],
      }),
    ])
  }
  useEffect(() => setRows(storage), [storage])
  return (
    <SettingsSection
      id="backup-storage"
      title="Backup storage"
      description="S3-compatible destinations shared by this workspace’s project backup policies."
    >
      {rows.length ? (
        <div className="space-y-4">
          <div className="divide-y">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <HardDriveIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.name}</p>
                  <p className="break-all text-sm text-muted-foreground">
                    {row.bucket} · {row.region}
                    {row.endpoint ? ` · ${row.endpoint}` : ' · Amazon S3'}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(row)}
                    >
                      <PencilIcon data-icon="inline-start" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDeleteError(null)
                        setRemoving(row)
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {canManage ? (
            <Button
              variant="outline"
              type="button"
              onClick={() => setEditing('new')}
            >
              <PlusIcon data-icon="inline-start" />
              Add storage
            </Button>
          ) : null}
        </div>
      ) : (
        <Empty className="min-h-40">
          <EmptyHeader>
            <EmptyTitle>No backup storage.</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? 'Add storage to upload backups to an existing S3-compatible bucket.'
                : 'An owner or admin can add backup storage for this workspace.'}
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button
                variant="outline"
                type="button"
                onClick={() => setEditing('new')}
              >
                <PlusIcon data-icon="inline-start" />
                Add storage
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
      {removing ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open && !deleting) setRemoving(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove storage?</AlertDialogTitle>
              <AlertDialogDescription>
                Remove {removing.name} from this workspace. This does not delete
                the bucket or its files. Storage used by policies, active
                backups or retained remote backups cannot be removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <FieldError>{deleteError}</FieldError>
            <AlertDialogFooter>
              <Button
                variant="ghost"
                disabled={deleting}
                onClick={() => setRemoving(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true)
                  setDeleteError(null)
                  try {
                    await refreshRows(
                      await deleteBackupStorageAction({
                        data: { teamSlug: team.slug, storageId: removing.id },
                      }),
                    )
                    setRemoving(null)
                    toast.success('Backup storage removed.')
                  } catch (cause) {
                    setDeleteError(
                      getErrorMessage(cause, 'Unable to remove storage.'),
                    )
                  } finally {
                    setDeleting(false)
                  }
                }}
              >
                {deleting ? (
                  <LoaderIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : null}
                Remove storage
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {editing ? (
        <BackupStorageDialog
          key={editing === 'new' ? 'new' : editing.id}
          storage={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const saved = await saveBackupStorageAction({
              data: { teamSlug: team.slug, input },
            })
            await refreshRows(saved)
          }}
        />
      ) : null}
    </SettingsSection>
  )
}

function BackupStorageDialog({
  storage,
  onSave,
  onClose,
}: {
  storage?: BackupStorageSummary
  onSave: (input: ReturnType<typeof backupStorageSchema.parse>) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState({
    name: storage?.name ?? '',
    bucket: storage?.bucket ?? '',
    region: storage?.region ?? 'auto',
    endpoint: storage?.endpoint ?? '',
    accessKeyId: storage?.accessKeyId ?? '',
    secretAccessKey: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState(false)
  const fields = [
    { key: 'name', label: 'Name', placeholder: 'Production backups' },
    {
      key: 'bucket',
      label: 'Bucket',
      placeholder: 'my-backups',
      location: true,
    },
    {
      key: 'region',
      label: 'Region',
      placeholder: 'us-east-1 or auto',
      location: true,
    },
    {
      key: 'endpoint',
      label: 'Endpoint',
      placeholder: 'https://…',
      location: true,
      optional: true,
      description:
        'Leave empty for Amazon S3. For other providers, use the S3 API endpoint.',
    },
    { key: 'accessKeyId', label: 'Access key ID' },
    {
      key: 'secretAccessKey',
      label: 'Secret access key',
      secret: true,
      optional: Boolean(storage),
      description: storage
        ? 'Leave empty to keep the saved secret. A replacement is stored encrypted.'
        : 'Stored encrypted and never displayed again.',
    },
  ] as const
  async function submit() {
    if (busy) return
    const parsed = backupStorageSchema.safeParse({ ...draft, id: storage?.id })
    if (!parsed.success) {
      setErrors(formErrors(parsed.error.issues))
      return
    }
    if (!storage && !draft.secretAccessKey) {
      setErrors({ secretAccessKey: 'Enter a secret access key.' })
      return
    }
    setErrors({})
    setBusy(true)
    try {
      await onSave(parsed.data)
      toast.success(
        storage ? 'Backup storage updated.' : 'Backup storage added.',
      )
      onClose()
    } catch (cause) {
      setErrors({
        form: getErrorMessage(cause, 'Unable to save backup storage.'),
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {storage ? 'Edit backup storage' : 'Add backup storage'}
          </DialogTitle>
          <DialogDescription>
            {storage
              ? 'Changes to credentials apply to every policy using this destination. Create another destination to use a different bucket or endpoint.'
              : 'Create the bucket with your provider first, then add its connection here.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="backup-storage-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <fieldset disabled={busy}>
            <FieldGroup>
              {fields.map((field) => (
                <Field key={field.key}>
                  <FieldLabel htmlFor={`storage-${field.key}`}>
                    {field.label}
                    {'optional' in field && field.optional ? '' : ' (required)'}
                  </FieldLabel>
                  <Input
                    id={`storage-${field.key}`}
                    value={draft[field.key]}
                    type={'secret' in field ? 'password' : 'text'}
                    readOnly={Boolean(storage && 'location' in field)}
                    placeholder={
                      'placeholder' in field ? field.placeholder : undefined
                    }
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={
                      errors[field.key]
                        ? `storage-${field.key}-error`
                        : undefined
                    }
                    onChange={(event) =>
                      setDraft({ ...draft, [field.key]: event.target.value })
                    }
                  />
                  {'description' in field ? (
                    <FieldDescription>{field.description}</FieldDescription>
                  ) : null}
                  <FieldError id={`storage-${field.key}-error`}>
                    {errors[field.key]}
                  </FieldError>
                </Field>
              ))}
              <FieldError>{errors.form}</FieldError>
            </FieldGroup>
          </fieldset>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" form="backup-storage-form" disabled={busy}>
            {busy ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : null}
            {storage ? 'Save' : 'Add storage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
