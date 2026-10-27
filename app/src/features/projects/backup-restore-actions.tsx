import { useState } from 'react'
import type { ReactNode } from 'react'
import { LoaderIcon } from 'lucide-react'
import {
  databaseArtifactTarget,
  backupDatabaseEngines,
} from '#devpush/lib/backup-database'
import { backupRestoreArtifactSchema } from '#devpush/lib/backup-restore-schema'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { Button } from '#devpush/components/ui/button'
import { BackupTimestamp } from './backup-timestamp'
import { EnvironmentDot } from './environment-dot'
import { ServerAvatar } from '#devpush/features/servers/server-avatar'
import type { ServerStatus } from '#devpush/server/servers/status'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#devpush/components/ui/tooltip'
import { BackupStatusIcon } from './backup-status-icon'
import { Checkbox } from '#devpush/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#devpush/components/ui/dialog'
import { FieldError } from '#devpush/components/ui/field'
import type {
  ProjectBackupArtifact,
  ProjectBackupRestore,
  ProjectBackupRun,
} from '#devpush/server/projects/types'
import {
  formatBytes,
  formatBackupStatus,
  getComposeArtifactName,
  getComposeVolumeName,
} from './project-backup-utils'
import type { z } from 'zod'

export type BackupRestoreSelection = z.infer<typeof backupRestoreArtifactSchema>
type Restore = (input: {
  run: ProjectBackupRun
  artifacts: BackupRestoreSelection[]
}) => Promise<void>

function restoreContents(
  artifacts: ProjectBackupArtifact[],
  run: ProjectBackupRun,
  projectId: string,
) {
  const contents = new Map<
    string,
    {
      artifact: ProjectBackupArtifact
      name: string
      database?: ReturnType<typeof databaseArtifactTarget>
    }
  >()
  for (const artifact of artifacts) {
    if (
      run.localRecoveryAvailable &&
      run.status !== 'succeeded' &&
      artifact.storage !== 'local'
    )
      continue
    const database =
      artifact.type === 'database'
        ? databaseArtifactTarget(artifact.objectKey, run.databaseTargets ?? [])
        : undefined
    if (
      artifact.type !== 'volume' &&
      (!database || database.engine === 'needs_configuration')
    )
      continue
    const name = getComposeArtifactName(artifact, projectId, run.environmentId)
    // Local and remote copies share the same generated filename. Keep one target,
    // preferring the recorded local copy; remote-only contents remain restorable.
    const key = `${artifact.type}:${artifact.objectKey.split('/').at(-1)}`
    const current = contents.get(key)
    if (!current || artifact.storage === 'local')
      contents.set(key, { artifact, name, database })
  }
  return [...contents.values()]
}

export function BackupRunRestoreActions({
  projectId,
  policyName,
  targetServerName,
  targetServerStatus,
  artifacts,
  disabled,
  restoringRunId,
  run,
  onRestore,
}: {
  projectId: string
  policyName?: string
  targetServerName?: string
  targetServerStatus?: ServerStatus
  artifacts: ProjectBackupArtifact[]
  disabled: boolean
  restoringRunId: string | null
  run: ProjectBackupRun
  onRestore: Restore
}) {
  const [open, setOpen] = useState(false)
  const contents = restoreContents(artifacts, run, projectId)
  if (run.status !== 'succeeded' && !run.localRecoveryAvailable) return <span />
  if (!contents.length)
    return artifacts.some((a) => a.type === 'database') ? (
      <span
        className="text-xs text-muted-foreground"
        title="This backup has no supported engine metadata. Restore the file manually."
      >
        Manual restore required
      </span>
    ) : (
      <span />
    )
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Restore"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Restore
      </Button>
      {open ? (
        <RestoreBackupDialog
          contents={contents}
          policyName={policyName}
          targetServerName={targetServerName}
          targetServerStatus={targetServerStatus}
          run={run}
          isRestoring={restoringRunId === run.id}
          onClose={() => setOpen(false)}
          onRestore={onRestore}
        />
      ) : null}
    </>
  )
}

function RestoreBackupDialog({
  contents,
  policyName,
  targetServerName,
  targetServerStatus,
  run,
  isRestoring,
  onClose,
  onRestore,
}: {
  contents: ReturnType<typeof restoreContents>
  policyName?: string
  targetServerName?: string
  targetServerStatus?: ServerStatus
  run: ProjectBackupRun
  isRestoring: boolean
  onClose: () => void
  onRestore: Restore
}) {
  const [selected, setSelected] = useState(
    () => new Set(contents.map((item) => item.artifact.id)),
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = pending || isRestoring
  async function submit() {
    if (busy || !selected.size) return
    setError(null)
    setPending(true)
    try {
      const artifacts = contents
        .filter((item) => selected.has(item.artifact.id))
        .map(({ artifact, name, database }) =>
          backupRestoreArtifactSchema.parse(
            artifact.type === 'volume'
              ? {
                  artifactId: artifact.id,
                  type: 'volume',
                  targetVolume: name,
                }
              : {
                  artifactId: artifact.id,
                  type: 'database',
                  targetService: database!.service,
                },
          ),
        )
      await onRestore({ run, artifacts })
      onClose()
    } catch (cause) {
      setError(
        getPublicErrorMessage(
          cause,
          'Unable to queue restore. Please try again.',
        ),
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restore backup</DialogTitle>
          <DialogDescription>
            Select the volumes and databases to restore from this backup.
            Selected data will be replaced. The application stops during volume
            restoration.
          </DialogDescription>
        </DialogHeader>
        <BackupRestoreSummary
          policyName={policyName}
          run={run}
          serverName={targetServerName}
          serverStatus={targetServerStatus}
        />
        <form
          id="backup-restore-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            {(['volume', 'database'] as const).map((type) => {
              const items = contents.filter(
                (item) => item.artifact.type === type,
              )
              return (
                <BackupRestoreSection
                  key={type}
                  title={type === 'volume' ? 'Volumes' : 'Databases'}
                >
                  <ul>
                    {items.length ? (
                      items.map(({ artifact, name, database }) => {
                        const engine = database
                          ? backupDatabaseEngines.find(
                              (item) => item.value === database.engine,
                            )?.label
                          : undefined
                        return (
                          <li
                            key={artifact.id}
                            className="border-b last:border-b-0"
                          >
                            <label className="flex min-w-0 cursor-pointer items-start gap-2 px-4 py-2 hover:bg-muted/50">
                              <Checkbox
                                className="mt-0.5"
                                checked={selected.has(artifact.id)}
                                disabled={busy}
                                aria-label={`Restore ${type} ${name}${database ? ` (${database.database || 'all databases'})` : ''}`}
                                onCheckedChange={(checked) =>
                                  setSelected((previous) => {
                                    const next = new Set(previous)
                                    if (checked === true) next.add(artifact.id)
                                    else next.delete(artifact.id)
                                    return next
                                  })
                                }
                              />
                              <span className="min-w-0 break-words">
                                {name}
                                <span className="ml-2 text-muted-foreground">
                                  {formatBytes(artifact.sizeBytes)}
                                </span>
                                {database ? (
                                  <span className="ml-2 text-muted-foreground">
                                    {database.database || 'All databases'} ·{' '}
                                    {engine}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        )
                      })
                    ) : (
                      <li className="px-4 py-2 text-muted-foreground">
                        {type === 'volume' ? 'No volumes' : 'No databases'}
                      </li>
                    )}
                  </ul>
                </BackupRestoreSection>
              )
            })}
            <FieldError>{error}</FieldError>
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
          <Button
            type="submit"
            form="backup-restore-form"
            disabled={busy || !selected.size}
          >
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

function BackupRestoreSummary({
  policyName,
  run,
  serverName,
  serverStatus,
}: {
  policyName?: string
  run: ProjectBackupRun
  serverName?: string
  serverStatus?: ServerStatus
}) {
  return (
    <BackupRestoreSection title="Backup">
      <dl className="divide-y">
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
          <dt className="text-muted-foreground">Created</dt>
          <dd>
            <BackupTimestamp
              value={run.startedAt ?? run.createdAt}
              className="text-foreground"
            />
          </dd>
        </div>
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
          <dt className="text-muted-foreground">Policy</dt>
          <dd
            className={`min-w-0 break-words${policyName ? '' : ' text-muted-foreground'}`}
          >
            {policyName ?? 'Deleted policy'}
          </dd>
        </div>
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
          <dt className="text-muted-foreground">Environment</dt>
          <dd className="flex min-w-0 items-center gap-2">
            <EnvironmentDot color={run.environmentColor} />
            {run.environmentName}
          </dd>
        </div>
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
          <dt className="text-muted-foreground">Server</dt>
          <dd className="flex min-w-0 items-center gap-2">
            {serverStatus ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <ServerAvatar
                    name={serverName ?? run.serverName ?? 'Server'}
                    status={serverStatus}
                    size="sm"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {serverStatus.charAt(0).toUpperCase() + serverStatus.slice(1)}
                </TooltipContent>
              </Tooltip>
            ) : null}
            <span className="min-w-0 break-words">
              {serverName ?? run.serverName ?? 'Unknown server'}
            </span>
          </dd>
        </div>
      </dl>
    </BackupRestoreSection>
  )
}

export function BackupRestoreDetails({
  run,
  restore,
  policyName,
  projectId,
  serverStatus,
  onClose,
}: {
  run?: ProjectBackupRun
  restore: ProjectBackupRestore
  policyName?: string
  projectId: string
  serverStatus?: ServerStatus
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restore details</DialogTitle>
          <DialogDescription>
            Restore status, source backup, and data selected for recovery.
          </DialogDescription>
        </DialogHeader>
        <BackupRestoreSection title="Restore">
          <dl className="divide-y">
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
              <dt className="text-muted-foreground">Started</dt>
              <dd>
                {restore.startedAt ? (
                  <BackupTimestamp
                    value={restore.startedAt}
                    className="text-foreground"
                  />
                ) : (
                  <span className="text-muted-foreground">
                    {restore.status === 'queued'
                      ? 'Not started'
                      : 'Not recorded'}
                  </span>
                )}
              </dd>
            </div>
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd
                className={`flex items-center gap-2 ${restore.status === 'succeeded' ? 'text-success' : restore.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                <BackupStatusIcon status={restore.status} />
                {formatBackupStatus(restore.status)}
              </dd>
            </div>
            {restore.errorMessage ? (
              <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
                <dt className="text-muted-foreground">Message</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground">
                  {restore.errorMessage}
                </dd>
              </div>
            ) : null}
          </dl>
        </BackupRestoreSection>{' '}
        {run ? (
          <BackupRestoreSummary
            policyName={policyName}
            run={run}
            serverName={restore.serverName ?? undefined}
            serverStatus={serverStatus}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Source backup no longer available.
          </p>
        )}
        {restore.artifacts ? (
          <div className="space-y-4" aria-label="Restored contents">
            {(['volume', 'database'] as const).map((type) => {
              const items = restore.artifacts!.filter(
                (item) => item.type === type,
              )
              return (
                <BackupRestoreSection
                  key={type}
                  title={type === 'volume' ? 'Volumes' : 'Databases'}
                >
                  {items.length ? (
                    <ul className="divide-y">
                      {items.map((item) => {
                        const artifact = run?.artifacts.find(
                          (a) => a.id === item.artifactId,
                        )
                        const database =
                          artifact && type === 'database'
                            ? databaseArtifactTarget(
                                artifact.objectKey,
                                run?.databaseTargets ?? [],
                              )
                            : undefined
                        const name =
                          type === 'volume'
                            ? item.targetVolume
                              ? getComposeVolumeName(
                                  item.targetVolume,
                                  projectId,
                                  restore.environmentId,
                                )
                              : undefined
                            : item.targetService
                        return (
                          <li
                            key={item.artifactId}
                            className="min-w-0 break-words px-4 py-2"
                          >
                            {name ??
                              (artifact && run
                                ? getComposeArtifactName(
                                    artifact,
                                    projectId,
                                    run.environmentId,
                                  )
                                : 'Unknown target')}
                            {artifact ? (
                              <span className="ml-2 text-muted-foreground">
                                {formatBytes(artifact.sizeBytes)}
                              </span>
                            ) : null}
                            {database ? (
                              <span className="ml-2 text-muted-foreground">
                                {database.database || 'All databases'}
                              </span>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="px-4 py-2 text-muted-foreground">
                      {type === 'volume' ? 'No volumes' : 'No databases'}
                    </p>
                  )}
                </BackupRestoreSection>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Recorded contents are unavailable.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BackupRestoreSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="overflow-hidden rounded-xl border bg-card text-card-foreground text-sm">
        {children}
      </div>
    </section>
  )
}
