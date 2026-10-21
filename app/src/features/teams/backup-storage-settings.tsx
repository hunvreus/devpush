import { showSettingsConflict } from '@/lib/settings-conflict'
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
import { LoaderIcon, SettingsIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { toast } from 'sonner'
import { SettingsSection } from '@/components/settings-layout'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
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
import { getPublicErrorMessage } from '@/lib/public-error'
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
          <div className="overflow-hidden rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Bucket</TableHead>
                  <TableHead className="w-24">Region</TableHead>
                  <TableHead className="last:pr-4">Endpoint</TableHead>
                  {canManage ? (
                    <TableHead className="w-24">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4">
                      <span
                        className="block truncate font-medium"
                        title={row.name}
                      >
                        {row.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block truncate" title={row.bucket}>
                        {row.bucket}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block truncate" title={row.region}>
                        {row.region}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground last:pr-4">
                      <span
                        className="block truncate"
                        title={row.endpoint ?? 'Amazon S3'}
                      >
                        {row.endpoint ?? 'Amazon S3'}
                      </span>
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="-mr-2 flex justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label={`Settings for ${row.name}`}
                                onClick={() => setEditing(row)}
                              >
                                <SettingsIcon />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Storage settings</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="icon"
                                variant="destructive"
                                aria-label={`Remove ${row.name}`}
                                onClick={() => {
                                  setRemoving(row)
                                }}
                              >
                                <TrashIcon />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Remove storage</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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

                  try {
                    await refreshRows(
                      await deleteBackupStorageAction({
                        data: {
                          teamSlug: team.slug,
                          storageId: removing.id,
                          settingsVersion: removing.settingsVersion,
                        },
                      }),
                    )
                    setRemoving(null)
                    toast.success('Backup storage removed.')
                  } catch (cause) {
                    if (showSettingsConflict(cause)) return
                    toast.error(
                      getPublicErrorMessage(cause, 'Unable to remove storage.'),
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
              data: {
                teamSlug: team.slug,
                input,
                settingsVersion:
                  editing === 'new' ? null : editing.settingsVersion,
              },
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
    },
  ] as const
  async function submit() {
    if (busy) return
    const parsed = backupStorageSchema.safeParse({ ...draft, id: storage?.id })
    const validationErrors: FormErrors = parsed.success
      ? {}
      : formErrors(parsed.error.issues)
    if (!storage && !draft.secretAccessKey.trim()) {
      validationErrors.secretAccessKey = 'Enter a secret access key.'
    }
    if (!parsed.success || Object.keys(validationErrors).length > 0) {
      if (validationErrors.form) toast.error(validationErrors.form)
      setErrors(validationErrors)
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
      if (showSettingsConflict(cause)) return
      toast.error(
        getPublicErrorMessage(cause, 'Unable to save backup storage.'),
      )
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-xl">
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
          <fieldset className="min-w-0" disabled={busy}>
            <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
              {fields.map((field) => (
                <Field
                  key={field.key}
                  className={
                    field.key === 'name' || field.key === 'endpoint'
                      ? 'sm:col-span-2'
                      : undefined
                  }
                >
                  <FieldLabel htmlFor={`storage-${field.key}`}>
                    {field.label}
                    {'optional' in field ? ' (optional)' : ''}
                  </FieldLabel>
                  <Input
                    id={`storage-${field.key}`}
                    value={
                      storage && field.key === 'secretAccessKey'
                        ? '••••••••••••••••'
                        : draft[field.key]
                    }
                    type={'secret' in field ? 'password' : 'text'}
                    readOnly={Boolean(
                      storage &&
                      ('location' in field || field.key === 'secretAccessKey'),
                    )}
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
