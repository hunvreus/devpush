import { navigateFilters } from '@/lib/action-feedback'
import { canManageTeamSettings } from '@/lib/team-role'
import { BackupPolicyDeleteDialog } from './backup-policy-delete-dialog'
import { Link, useParams, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  BanIcon,
  CircleCheckIcon,
  ClockIcon,
  CircleXIcon,
  LoaderIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PlayIcon,
  PauseIcon,
  TrashIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { ProjectHeading } from './project-heading'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import { getErrorMessage } from '@/lib/error-message'
import { setProjectContextQueryData } from '@/lib/project-context-query'
import {
  runProjectBackup,
  restoreProjectBackup,
  saveProjectBackupConfigs,
} from '@/server/projects/functions'
import type {
  ProjectBackupConfig,
  ProjectBackupArtifact,
  ProjectBackupRun,
  ProjectContext,
} from '@/server/projects/types'

import {
  filterBackupRuns,
  formatBackupArtifacts,
  formatBackupDate as formatDate,
  formatBackupSchedule as formatSchedule,
  formatBackupStatus as formatStatus,
  inferArtifactName,
} from './project-backup-utils'
import type { BackupFilters } from './project-backup-utils'
import { BackupRunRestoreActions } from './backup-restore-actions'
import { BackupPolicyDialog } from './project-backup-policy'

export function ProjectBackups({
  context,
  filters,
}: {
  context: ProjectContext
  filters: BackupFilters
}) {
  const params = useParams({ strict: false })
  const router = useRouter()
  const queryClient = useQueryClient()
  const canManage = canManageTeamSettings(context.team.role)
  const [backupConfigs, setBackupConfigs] = useState(context.backupConfigs)
  const [backupRuns, setBackupRuns] = useState(context.backupRuns)
  const [savingPolicyId, setSavingPolicyId] = useState<string | null>(null)
  const [runningBackupId, setRunningBackupId] = useState<string | null>(null)
  const [restoringArtifactId, setRestoringArtifactId] = useState<string | null>(
    null,
  )
  const [deleteTarget, setDeleteTarget] = useState<ProjectBackupConfig | null>(
    null,
  )
  const actionBusy =
    savingPolicyId !== null ||
    runningBackupId !== null ||
    restoringArtifactId !== null
  const runs = filterBackupRuns(backupRuns, filters)
  const teamSlug =
    typeof params.teamSlug === 'string' ? params.teamSlug : context.team.slug
  const projectName =
    typeof params.projectName === 'string'
      ? params.projectName
      : context.project.name

  useEffect(() => {
    setBackupConfigs(context.backupConfigs)
  }, [context.backupConfigs])

  useEffect(() => {
    setBackupRuns(context.backupRuns)
  }, [context.backupRuns])

  function setFilter(key: keyof BackupFilters, value: string) {
    void navigateFilters(() =>
      router.navigate({
        to: '/$teamSlug/projects/$projectName/backups',
        params: {
          teamSlug,
          projectName,
        },
        search: (current) => ({
          ...current,
          [key]: value === 'all' ? undefined : value,
        }),
      }),
    )
  }

  async function updateBackupConfigs(
    nextConfigs: Array<ProjectBackupConfig>,
    message: string,
    policyId?: string,
  ) {
    if (policyId) {
      setSavingPolicyId(policyId)
    }

    try {
      const nextContext = await saveProjectBackupConfigs({
        data: {
          teamSlug,
          projectName,
          backupConfigs: nextConfigs,
        },
      })
      await setProjectContextQueryData(queryClient, nextContext, 'backups')
      setBackupConfigs(nextContext.backupConfigs)
      setBackupRuns(nextContext.backupRuns)
      toast.success(message)
    } finally {
      if (policyId) {
        setSavingPolicyId(null)
      }
    }
  }

  async function setPolicyEnabled(
    backup: ProjectBackupConfig,
    enabled: boolean,
  ) {
    if (actionBusy) return
    const nextConfigs = backupConfigs.map((item) =>
      item.id === backup.id ? { ...item, enabled } : item,
    )
    try {
      await updateBackupConfigs(
        nextConfigs,
        enabled ? 'Backup policy resumed.' : 'Backup policy paused.',
        backup.id,
      )
    } catch (cause) {
      toast.error(
        getErrorMessage(
          cause,
          'Unable to save backup policy. Please try again.',
        ),
      )
    }
  }

  async function deletePolicy(backup: ProjectBackupConfig) {
    const nextConfigs = backupConfigs.filter((item) => item.id !== backup.id)
    await updateBackupConfigs(nextConfigs, 'Backup policy deleted.', backup.id)
  }

  async function runBackup(backup: ProjectBackupConfig) {
    if (actionBusy) return
    setRunningBackupId(backup.id)

    try {
      const nextContext = await runProjectBackup({
        data: {
          teamSlug,
          projectName,
          backupConfigId: backup.id,
        },
      })
      await setProjectContextQueryData(queryClient, nextContext, 'backups')
      setBackupConfigs(nextContext.backupConfigs)
      setBackupRuns(nextContext.backupRuns)
      toast.success('Backup queued.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to queue backup.'))
    } finally {
      setRunningBackupId(null)
    }
  }

  async function restoreArtifact({
    artifact,
    run,
    targetService,
    targetVolume,
  }: {
    artifact: ProjectBackupArtifact
    run: ProjectBackupRun
    targetService?: string
    targetVolume?: string
  }) {
    setRestoringArtifactId(artifact.id)

    try {
      const nextContext = await restoreProjectBackup({
        data: {
          teamSlug,
          projectName,
          backupRunId: run.id,
          artifacts:
            artifact.type === 'volume'
              ? [
                  {
                    artifactId: artifact.id,
                    type: 'volume',
                    targetVolume: targetVolume ?? inferArtifactName(artifact),
                  },
                ]
              : [
                  {
                    artifactId: artifact.id,
                    type: 'database',
                    targetService: targetService ?? '',
                  },
                ],
        },
      })
      await setProjectContextQueryData(queryClient, nextContext, 'backups')
      setBackupConfigs(nextContext.backupConfigs)
      setBackupRuns(nextContext.backupRuns)
      toast.success('Restore queued.')
    } finally {
      setRestoringArtifactId(null)
    }
  }

  return (
    <>
      <ProjectHeading
        teamSlug={teamSlug}
        project={context.project}
        crumbs={[<span className="truncate">Backups</span>]}
      />

      {backupConfigs.length === 0 ? (
        <Empty className="min-h-60 border bg-card text-card-foreground">
          <EmptyHeader>
            <EmptyTitle>No backup policies yet.</EmptyTitle>
            <EmptyDescription>
              Create a backup policy for a specific environment.
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <BackupPolicyDialog
                context={context}
                teamSlug={teamSlug}
                projectName={projectName}
                backupConfigs={backupConfigs}
                onSaved={setBackupConfigs}
              >
                <Button
                  disabled={context.environments.length === 0 || actionBusy}
                >
                  <PlusIcon data-icon="inline-start" />
                  Create policy
                </Button>
              </BackupPolicyDialog>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <>
          <section className="space-y-4">
            <header className="flex h-8 items-center justify-between gap-x-4">
              <h2 className="text-base font-medium">Policies</h2>
              {canManage ? (
                <BackupPolicyDialog
                  context={context}
                  teamSlug={teamSlug}
                  projectName={projectName}
                  backupConfigs={backupConfigs}
                  onSaved={setBackupConfigs}
                >
                  <Button>
                    <PlusIcon data-icon="inline-start" />
                    Create policy
                  </Button>
                </BackupPolicyDialog>
              ) : null}
            </header>
            <ul className="overflow-hidden rounded-xl border bg-card text-card-foreground">
              {backupConfigs.map((backup) => {
                const environment = context.environments.find(
                  (item) => item.id === backup.environmentId,
                )
                const latestRun =
                  backupRuns.find((run) => run.configId === backup.id) ?? null

                return (
                  <li
                    key={backup.id}
                    className="border-b text-sm last:border-b-0"
                  >
                    <div className="flex h-11 items-center gap-4 px-4 hover:bg-muted/50">
                      <BackupStatusIcon
                        enabled={backup.enabled}
                        status={latestRun?.status ?? null}
                      />
                      <Link
                        to="/$teamSlug/projects/$projectName/backups/$backupId"
                        params={{ teamSlug, projectName, backupId: backup.id }}
                        className="min-w-0 max-w-80 truncate font-medium hover:underline"
                      >
                        {backup.name}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
                        <ClockIcon />
                        <span>{formatSchedule(backup.schedule)}</span>
                      </span>
                      {environment ? (
                        <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-muted-foreground">
                          <EnvironmentDot color={environment.color} />
                          <span>{environment.name}</span>
                        </span>
                      ) : (
                        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                          Unknown environment
                        </span>
                      )}
                      {canManage ? (
                        <div className="ml-auto flex shrink-0 items-center">
                          <BackupPolicyActions
                            disabled={actionBusy}
                            enabled={backup.enabled}
                            onDelete={() => setDeleteTarget(backup)}
                            onRun={() => void runBackup(backup)}
                            onToggle={() =>
                              void setPolicyEnabled(backup, !backup.enabled)
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                    {latestRun?.status === 'failed' ? (
                      <Alert variant="destructive" className="mx-4 mb-3 w-auto">
                        <TriangleAlertIcon />
                        <AlertDescription>
                          {latestRun.localRecoveryAvailable
                            ? 'Remote upload failed; local backup available. Check the storage connection and run this policy again.'
                            : (latestRun.errorMessage ??
                              'The latest backup failed. Run this policy again after resolving the error.')}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="space-y-4">
            <header className="flex h-8 items-center justify-between gap-x-4">
              <h2 className="text-base font-medium">Runs</h2>
            </header>

            {backupRuns.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={filters.environment ?? 'all'}
                  onValueChange={(value) => setFilter('environment', value)}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All environments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All environments</SelectItem>
                    {context.environments.map((environment) => (
                      <SelectItem key={environment.id} value={environment.id}>
                        {environment.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filters.status ?? 'all'}
                  onValueChange={(value) => setFilter('status', value)}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="queued">Queued</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="succeeded">Succeeded</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={filters.server ?? 'all'}
                  onValueChange={(value) => setFilter('server', value)}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="All servers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All servers</SelectItem>
                    {context.servers.map((server) => (
                      <SelectItem key={server.id} value={server.id}>
                        {server.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filters.time ?? 'all'}
                  onValueChange={(value) => setFilter('time', value)}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="All dates" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All dates</SelectItem>
                    <SelectItem value="24h">Last 24 hours</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {runs.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border bg-card text-card-foreground">
                <div className="grid min-h-12 min-w-256 grid-cols-[.8fr_1fr_1fr_1fr_1.4fr_1fr_6rem] gap-x-4 items-center border-b px-4 py-2 text-sm font-medium">
                  <span>Status</span>
                  <span>Environment</span>
                  <span>Server</span>
                  <span>Artifacts</span>
                  <span>Started</span>
                  <span>Latest restore</span>
                  <span />
                </div>
                {runs.map((run) => {
                  const restore = context.backupRestores.find(
                    (item) => item.backupRunId === run.id,
                  )
                  return (
                    <div
                      key={run.id}
                      className="grid min-h-12 min-w-256 grid-cols-[.8fr_1fr_1fr_1fr_1.4fr_1fr_6rem] gap-x-4 items-center border-b px-4 py-2 text-sm last:border-b-0"
                    >
                      <span className="inline-flex items-center gap-2">
                        <BackupStatusIcon status={run.status} />
                        {formatStatus(run.status)}
                      </span>
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <EnvironmentDot color={run.environmentColor} />
                        {run.environmentName}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {run.serverName ?? 'Unknown server'}
                      </span>
                      <span className="text-muted-foreground">
                        {formatBackupArtifacts(run.artifacts)}
                      </span>
                      <span className="whitespace-nowrap text-muted-foreground">
                        {formatDate(run.startedAt ?? run.createdAt)}
                      </span>
                      {restore ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              role="status"
                              tabIndex={0}
                              aria-label={`Restore ${restore.status}`}
                              className="inline-flex w-fit items-center gap-2 whitespace-nowrap"
                            >
                              <BackupStatusIcon status={restore.status} />
                              {formatStatus(restore.status)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {formatDate(
                              restore.finishedAt ??
                                restore.startedAt ??
                                restore.createdAt,
                            )}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {canManage ? (
                        <BackupRunRestoreActions
                          projectId={context.project.id}
                          targetServerName={
                            context.servers.find(
                              (server) =>
                                server.id ===
                                context.environments.find(
                                  (environment) =>
                                    environment.id === run.environmentId,
                                )?.effectiveServerId,
                            )?.name ?? 'No server assigned'
                          }
                          artifacts={run.artifacts}
                          composeServices={
                            context.composeMetadata?.services ??
                            context.routes.map((route) => route.service)
                          }
                          composeVolumes={
                            context.composeMetadata?.volumes ?? []
                          }
                          disabled={
                            actionBusy ||
                            context.backupRestores.some(
                              (restore) =>
                                restore.environmentId === run.environmentId &&
                                ['queued', 'running'].includes(restore.status),
                            )
                          }
                          restoringArtifactId={restoringArtifactId}
                          run={run}
                          onRestore={restoreArtifact}
                        />
                      ) : (
                        <span />
                      )}
                      {restore?.status === 'failed' ? (
                        <BackupFailureAlert
                          title="Restore failed"
                          message={restore.errorMessage}
                          className="col-span-full my-2"
                        />
                      ) : null}
                      {run.status === 'failed' ? (
                        <BackupFailureAlert
                          className="col-span-full my-2"
                          title={
                            run.localRecoveryAvailable
                              ? 'Remote upload failed'
                              : 'Backup failed'
                          }
                          message={run.errorMessage}
                          description={
                            run.localRecoveryAvailable
                              ? 'Local backup available for restoration. Check the storage connection and run this policy again.'
                              : undefined
                          }
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <Empty className="min-h-60 border bg-card text-card-foreground">
                <EmptyHeader>
                  <EmptyTitle>No backup runs yet.</EmptyTitle>
                  <EmptyDescription>
                    Use Run in a policy’s actions menu or wait for its next
                    scheduled run.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </section>
        </>
      )}
      {deleteTarget ? (
        <BackupPolicyDeleteDialog
          name={deleteTarget.name}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          onDelete={() => deletePolicy(deleteTarget)}
        />
      ) : null}
    </>
  )
}

function BackupFailureAlert({
  title,
  message,
  description,
  className,
}: {
  title: string
  message: string | null
  description?: string
  className?: string
}) {
  return (
    <Alert variant="destructive" className={className}>
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {description ? <p>{description}</p> : null}
        {message ? (
          <details>
            <summary className="cursor-pointer">Error details</summary>
            <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">
              {message}
            </p>
          </details>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

function BackupPolicyActions({
  disabled,
  enabled,
  onDelete,
  onRun,
  onToggle,
}: {
  disabled?: boolean
  enabled: boolean
  onDelete: () => void
  onRun: () => void
  onToggle: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Backup policy actions"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={disabled} onSelect={onRun}>
          <PlayIcon />
          Run
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onSelect={onToggle}>
          {enabled ? <PauseIcon /> : <PlayIcon />}
          {enabled ? 'Pause' : 'Resume'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={disabled}
          variant="destructive"
          onSelect={onDelete}
        >
          <TrashIcon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BackupStatusIcon({
  enabled = true,
  status,
}: {
  enabled?: boolean
  status: ProjectBackupRun['status'] | null
}) {
  if (!enabled) {
    return <PauseIcon className="size-4 shrink-0 text-muted-foreground" />
  }
  if (status === 'succeeded') {
    return <CircleCheckIcon className="size-4 shrink-0 text-green-500" />
  }
  if (status === 'failed' || status === 'canceled') {
    return <CircleXIcon className="size-4 shrink-0 text-destructive" />
  }
  if (status === 'running' || status === 'queued') {
    return (
      <LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
    )
  }
  return <BanIcon className="size-4 shrink-0 text-muted-foreground" />
}
