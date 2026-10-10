import {
  databaseArtifactTarget,
  backupDatabaseEngines,
} from '@/lib/backup-database'
import { backupRestoreArtifactSchema } from '@/lib/backup-restore-schema'
import { formErrors } from '@/lib/form-errors'
import type { FormErrors } from '@/lib/form-errors'
import { getErrorMessage } from '@/lib/error-message'
import {
  ArchiveIcon,
  ArrowDownIcon,
  TriangleAlertIcon,
  CopyIcon,
  HardDriveIcon,
  LoaderIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { copyText } from '@/lib/action-feedback'
import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  ProjectBackupArtifact,
  ProjectBackupRun,
} from '@/server/projects/types'
import {
  formatBytes,
  formatBackupDate,
  getComposeArtifactName,
} from './project-backup-utils'

export function BackupRunRestoreActions({
  projectId,
  targetServerName,
  artifacts,
  composeServices,
  composeVolumes,
  disabled,
  restoringArtifactId,
  run,
  onRestore,
}: {
  projectId: string
  targetServerName?: string
  artifacts: Array<ProjectBackupArtifact>
  composeServices: Array<string>
  composeVolumes: Array<string>
  disabled: boolean
  restoringArtifactId: string | null
  run: ProjectBackupRun
  onRestore: (input: {
    artifact: ProjectBackupArtifact
    run: ProjectBackupRun
    targetService?: string
    targetVolume?: string
  }) => Promise<void>
}) {
  const restorableArtifacts = artifacts.filter(
    (artifact) =>
      artifact.type === 'volume' ||
      (artifact.type === 'database' &&
        databaseArtifactTarget(artifact.objectKey, run.databaseTargets ?? [])
          ?.engine !== 'needs_configuration' &&
        Boolean(
          databaseArtifactTarget(artifact.objectKey, run.databaseTargets ?? []),
        )),
  )
  const [selectedArtifact, setSelectedArtifact] =
    useState<ProjectBackupArtifact | null>(null)

  if (
    (run.status !== 'succeeded' && !run.localRecoveryAvailable) ||
    (restorableArtifacts.length === 0 &&
      !artifacts.some((a) => a.type === 'database'))
  ) {
    return <span />
  }

  if (restorableArtifacts.length === 0)
    return (
      <span
        className="text-xs text-muted-foreground"
        title="This backup has no supported engine metadata. Restore the file manually."
      >
        Manual restore required
      </span>
    )

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setSelectedArtifact(restorableArtifacts[0] ?? null)}
      >
        <RotateCcwIcon data-icon="inline-start" />
        Restore
      </Button>
      {selectedArtifact ? (
        <RestoreArtifactDialog
          key={selectedArtifact.id}
          artifact={selectedArtifact}
          artifacts={restorableArtifacts}
          projectId={projectId}
          targetServerName={targetServerName}
          onArtifactSelect={setSelectedArtifact}
          composeServices={composeServices}
          composeVolumes={composeVolumes}
          isRestoring={restoringArtifactId === selectedArtifact.id}
          open
          run={run}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedArtifact(null)
            }
          }}
          onRestore={onRestore}
        />
      ) : null}
    </>
  )
}

function RestoreArtifactDialog({
  targetServerName,
  artifacts,
  projectId,
  onArtifactSelect,
  artifact,
  composeServices,
  composeVolumes,
  isRestoring,
  open,
  run,
  onOpenChange,
  onRestore,
}: {
  targetServerName?: string
  artifacts: Array<ProjectBackupArtifact>
  projectId: string
  onArtifactSelect: (artifact: ProjectBackupArtifact) => void
  artifact: ProjectBackupArtifact
  composeServices: Array<string>
  composeVolumes: Array<string>
  isRestoring: boolean
  open: boolean
  run: ProjectBackupRun
  onOpenChange: (open: boolean) => void
  onRestore: (input: {
    artifact: ProjectBackupArtifact
    run: ProjectBackupRun
    targetService?: string
    targetVolume?: string
  }) => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const busy = pending || isRestoring
  const artifactName = getComposeArtifactName(
    artifact,
    projectId,
    run.environmentId,
  )
  const [targetVolume, setTargetVolume] = useState(
    artifact.type === 'volume'
      ? (composeVolumes.find((volume) => volume === artifactName) ??
          artifactName)
      : '',
  )
  const [targetService, setTargetService] = useState(
    artifact.type === 'database'
      ? (composeServices.find((service) => service === artifactName) ??
          artifactName)
      : '',
  )
  const databaseTarget = databaseArtifactTarget(
    artifact.objectKey,
    run.databaseTargets ?? [],
  )
  async function submit() {
    if (busy) return
    const parsed = backupRestoreArtifactSchema.safeParse({
      artifactId: artifact.id,
      type: artifact.type,
      targetVolume,
      targetService,
    })
    if (!parsed.success) {
      setErrors(formErrors(parsed.error.issues))
      return
    }
    setErrors({})
    setPending(true)
    try {
      await onRestore({ artifact, run, ...parsed.data })
      onOpenChange(false)
    } catch (cause) {
      setErrors({
        form: getErrorMessage(
          cause,
          'Unable to queue restore. Please try again.',
        ),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore backup</DialogTitle>
          <DialogDescription>
            Review the source backup and where its data will be restored.
          </DialogDescription>
        </DialogHeader>
        <form
          id="backup-restore-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <fieldset disabled={busy}>
            <div className="grid gap-3">
              <section
                aria-label="Source backup"
                className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-4"
              >
                <h3 className="flex items-center gap-2 font-medium">
                  <ArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
                  Source
                </h3>
                {artifacts.length > 1 ? (
                  <Field>
                    <FieldLabel>Backup file</FieldLabel>
                    <Select
                      value={artifact.id}
                      onValueChange={(id) => {
                        const next = artifacts.find((item) => item.id === id)
                        if (next) onArtifactSelect(next)
                      }}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label="Backup file"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {artifacts.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {getComposeArtifactName(
                              item,
                              projectId,
                              run.environmentId,
                            )}{' '}
                            · {item.storage === 'local' ? 'Local' : 'Remote'} ·{' '}
                            {formatBytes(item.sizeBytes)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                <dl className="space-y-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {artifact.type === 'volume'
                        ? 'Volume'
                        : 'Database service'}
                    </dt>
                    <dd className="mt-1 font-mono text-[13px]">
                      {artifactName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">File</dt>
                    <dd className="mt-1 flex items-start gap-2">
                      <span
                        className="min-w-0 flex-1 break-all font-mono text-[13px]"
                        title={artifact.objectKey}
                      >
                        {artifact.objectKey.split('/').at(-1)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={
                          artifact.storage === 'local'
                            ? 'Copy full server path'
                            : 'Copy S3 object key'
                        }
                        title={artifact.objectKey}
                        onClick={() =>
                          void copyText(artifact.objectKey, 'Backup location')
                        }
                      >
                        <CopyIcon />
                      </Button>
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">Created</dt>
                      <dd className="mt-1">
                        {formatBackupDate(artifact.createdAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Size</dt>
                      <dd className="mt-1">
                        {formatBytes(artifact.sizeBytes)}
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Storage</dt>
                    <dd className="mt-1">
                      {artifact.storage === 'local'
                        ? `On ${run.serverName ?? 'the source server'}`
                        : 'S3-compatible storage'}
                    </dd>
                  </div>
                </dl>
              </section>
              <ArrowDownIcon
                aria-hidden="true"
                className="size-5 shrink-0 justify-self-center text-muted-foreground"
              />
              <section
                aria-label="Restore target"
                className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-4"
              >
                <h3 className="flex items-center gap-2 font-medium">
                  <HardDriveIcon className="size-4 shrink-0 text-muted-foreground" />
                  Target
                </h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Environment
                    </dt>
                    <dd className="mt-1">{run.environmentName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Server</dt>
                    <dd className="mt-1">
                      {targetServerName ?? run.serverName ?? 'Unknown server'}
                    </dd>
                  </div>
                </dl>
                <FieldGroup>
                  {artifact.type === 'volume' ? (
                    <Field>
                      <FieldLabel htmlFor="restore-volume">
                        Compose volume (required)
                      </FieldLabel>
                      <Select
                        value={targetVolume}
                        onValueChange={setTargetVolume}
                      >
                        <SelectTrigger
                          id="restore-volume"
                          aria-invalid={Boolean(errors.targetVolume)}
                          aria-describedby={
                            errors.targetVolume
                              ? 'restore-volume-error'
                              : undefined
                          }
                          className="w-full"
                        >
                          <SelectValue placeholder="Select volume" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from(
                            new Set([artifactName, ...composeVolumes]),
                          )
                            .filter(Boolean)
                            .map((volume) => (
                              <SelectItem key={volume} value={volume}>
                                {volume}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FieldError id="restore-volume-error">
                        {errors.targetVolume}
                      </FieldError>
                    </Field>
                  ) : (
                    <>
                      <Field>
                        <FieldLabel htmlFor="restore-service">
                          Compose service (required)
                        </FieldLabel>
                        <Select
                          value={targetService}
                          onValueChange={(value) => {
                            setTargetService(value)
                          }}
                        >
                          <SelectTrigger
                            id="restore-service"
                            aria-invalid={Boolean(errors.targetService)}
                            aria-describedby={
                              errors.targetService
                                ? 'restore-service-error'
                                : undefined
                            }
                            className="w-full"
                          >
                            <SelectValue placeholder="Select service" />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from(
                              new Set([artifactName, ...composeServices]),
                            )
                              .filter(Boolean)
                              .map((service) => (
                                <SelectItem key={service} value={service}>
                                  {service}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <FieldError id="restore-service-error">
                          {errors.targetService}
                        </FieldError>
                      </Field>
                      <Field>
                        <FieldLabel>Database</FieldLabel>
                        <p className="text-sm">
                          {backupDatabaseEngines.find(
                            (engine) => engine.value === databaseTarget?.engine,
                          )?.label ?? 'Unknown engine'}{' '}
                          · {databaseTarget?.database || 'All databases'}
                        </p>
                        <FieldDescription>
                          The database engine and scope come from this backup.
                          Restoration imports its data into the selected service
                          and may replace existing data.
                        </FieldDescription>
                      </Field>
                    </>
                  )}
                </FieldGroup>
              </section>
            </div>
            <Alert role="note" variant="destructive" className="mt-4">
              <TriangleAlertIcon />
              <AlertDescription>
                {artifact.type === 'volume'
                  ? 'The current files in this volume will be replaced. The application stops during restoration.'
                  : 'The restore command may replace existing database data.'}
              </AlertDescription>
            </Alert>
            <FieldError>{errors.form}</FieldError>
          </fieldset>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" form="backup-restore-form" disabled={busy}>
            {busy ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : null}
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
