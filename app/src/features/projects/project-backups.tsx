import { backupConfigSchema } from '@/lib/backup-policy-schema'
import { showSettingsConflict } from '@/lib/settings-conflict'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { BackupJobLogs } from './backup-job-logs'
import { navigateFilters } from '@/lib/action-feedback'
import { canManageTeamSettings } from '@/lib/team-role'
import { Link, useParams, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  Undo2Icon,
  EllipsisVerticalIcon,
  ClockIcon,
  PlusIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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
import { BackupStatusIcon } from './backup-status-icon'
import { BackupTimestamp } from './backup-timestamp'
import { ServerAvatar } from '@/features/servers/server-avatar'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import { getPublicErrorMessage } from '@/lib/public-error'
import { setProjectContextQueryData } from '@/lib/project-context-query'
import {
  runProjectBackup,
  restoreProjectBackup,
  saveProjectBackupPolicyAction,
  deleteProjectBackupPolicyAction,
} from '@/server/projects/functions'
import type {
  ProjectBackupConfig,
  ProjectBackupRun,
  ProjectBackupRestore,
  ProjectContext,
} from '@/server/projects/types'

import {
  getBackupActivity,
  getLatestBackupRuns,
  formatBackupSchedule as formatSchedule,
  formatBackupStatus as formatStatus,
} from './project-backup-utils'
import type { BackupFilters } from './project-backup-utils'
import {
  BackupRestoreDetails,
  BackupRunRestoreActions,
} from './backup-restore-actions'
import type { BackupRestoreSelection } from './backup-restore-actions'
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
  const [runConfirmation, setRunConfirmation] =
    useState<ProjectBackupConfig | null>(null)
  const [logOperation, setLogOperation] = useState<{
    type: 'backup' | 'restore'
    id: string
    errorMessage: string | null
  } | null>(null)
  const [detailsRestore, setDetailsRestore] =
    useState<ProjectBackupRestore | null>(null)
  const [runningBackupId, setRunningBackupId] = useState<string | null>(null)
  const [restoringRunId, setRestoringRunId] = useState<string | null>(null)
  const actionBusy =
    savingPolicyId !== null ||
    runningBackupId !== null ||
    restoringRunId !== null
  const latestBackupRuns = getLatestBackupRuns(backupRuns)
  const runs = getBackupActivity(backupRuns, context.backupRestores, filters)
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

  function resetFilters() {
    void navigateFilters(() =>
      router.navigate({
        to: '/$teamSlug/projects/$projectName/backups',
        params: { teamSlug, projectName },
        search: {},
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
      const policy = nextConfigs.find((item) => item.id === policyId)
      const original = backupConfigs.find((item) => item.id === policyId)!
      const nextContext = policy
        ? await saveProjectBackupPolicyAction({
            data: {
              projectId: context.project.id,
              teamSlug,
              projectName,
              settingsVersion: original.settingsVersion,
              policy: backupConfigSchema.parse(policy),
            },
          })
        : await deleteProjectBackupPolicyAction({
            data: {
              projectId: context.project.id,
              teamSlug,
              projectName,
              settingsVersion: original.settingsVersion,
              policyId: original.id,
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
        `${backup.name} ${enabled ? 'enabled' : 'disabled'}.`,
        backup.id,
      )
    } catch (cause) {
      if (showSettingsConflict(cause)) return
      toast.error(
        getPublicErrorMessage(
          cause,
          'Unable to save backup policy. Please try again.',
        ),
      )
    }
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
      setRunConfirmation(null)
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(getPublicErrorMessage(error, 'Unable to queue backup.'))
    } finally {
      setRunningBackupId(null)
    }
  }

  async function restoreBackup({
    run,
    artifacts,
  }: {
    run: ProjectBackupRun
    artifacts: BackupRestoreSelection[]
  }) {
    setRestoringRunId(run.id)
    try {
      const nextContext = await restoreProjectBackup({
        data: {
          teamSlug,
          projectName,
          backupRunId: run.id,
          artifacts,
        },
      })
      await setProjectContextQueryData(queryClient, nextContext, 'backups')
      setBackupConfigs(nextContext.backupConfigs)
      setBackupRuns(nextContext.backupRuns)
      toast.success('Restore queued.')
    } finally {
      setRestoringRunId(null)
    }
  }

  return (
    <>
      {detailsRestore ? (
        <BackupRestoreDetails
          projectId={context.project.id}
          restore={
            context.backupRestores.find(
              (item) => item.id === detailsRestore.id,
            ) ?? detailsRestore
          }
          run={backupRuns.find((run) => run.id === detailsRestore.backupRunId)}
          policyName={
            backupConfigs.find(
              (config) =>
                config.id ===
                backupRuns.find((run) => run.id === detailsRestore.backupRunId)
                  ?.configId,
            )?.name
          }
          serverStatus={
            context.servers.find(
              (server) => server.id === detailsRestore.serverId,
            )?.status
          }
          onClose={() => setDetailsRestore(null)}
        />
      ) : null}
      <ProjectHeading
        teamSlug={teamSlug}
        project={context.project}
        crumbs={[<span className="truncate">Backups</span>]}
      />
      <AlertDialog
        open={runConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !runningBackupId) {
            setRunConfirmation(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run {runConfirmation?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Queue a backup now for{' '}
              {context.environments.find(
                (environment) =>
                  environment.id === runConfirmation?.environmentId,
              )?.name ?? 'this environment'}{' '}
              using this policy’s saved configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={runningBackupId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={runningBackupId !== null}
              onClick={(event) => {
                event.preventDefault()
                if (runConfirmation) void runBackup(runConfirmation)
              }}
            >
              {runningBackupId ? 'Queuing…' : 'Run backup'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            <ul className="scrollbar overflow-x-auto rounded-xl border bg-card text-card-foreground">
              {backupConfigs.map((backup) => {
                const environment = context.environments.find(
                  (item) => item.id === backup.environmentId,
                )
                const latestRun = latestBackupRuns.get(backup.id) ?? null

                return (
                  <li
                    key={backup.id}
                    className="border-b text-sm last:border-b-0"
                  >
                    <div className="flex h-11 min-w-[30rem] items-center gap-4 px-4 whitespace-nowrap hover:bg-muted/50">
                      <Switch
                        id={`policy-enabled-${backup.id}`}
                        aria-label={`Enable ${backup.name}`}
                        checked={backup.enabled}
                        disabled={!canManage || actionBusy}
                        onCheckedChange={(value) =>
                          void setPolicyEnabled(backup, value)
                        }
                      />
                      <Link
                        to="/$teamSlug/projects/$projectName/backups/$backupId"
                        params={{ teamSlug, projectName, backupId: backup.id }}
                        className={`min-w-0 max-w-80 truncate font-medium ${backup.enabled ? '' : 'text-muted-foreground'}`}
                      >
                        {backup.name}
                      </Link>
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
                      <span className="hidden shrink-0 items-center gap-2 whitespace-nowrap text-muted-foreground sm:flex [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
                        <ClockIcon />
                        <span>{formatSchedule(backup.schedule)}</span>
                      </span>
                      <div className="ml-auto shrink-0">
                        <ButtonGroup
                          className="-mr-2"
                          aria-label="Backup policy actions"
                        >
                          {canManage ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={actionBusy}
                              onClick={() => {
                                setRunConfirmation(backup)
                              }}
                            >
                              Run
                            </Button>
                          ) : null}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label={`Actions for ${backup.name}`}
                              >
                                <EllipsisVerticalIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link
                                  to="/$teamSlug/projects/$projectName/backups"
                                  params={{ teamSlug, projectName }}
                                  search={{ policy: backup.id }}
                                  hash="activity"
                                >
                                  View activity
                                </Link>
                              </DropdownMenuItem>
                              {canManage ? (
                                <DropdownMenuItem asChild>
                                  <Link
                                    to="/$teamSlug/projects/$projectName/backups/$backupId"
                                    params={{
                                      teamSlug,
                                      projectName,
                                      backupId: backup.id,
                                    }}
                                  >
                                    Settings
                                  </Link>
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </ButtonGroup>
                      </div>
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
        </>
      )}
      <section id="activity" className="space-y-4 scroll-mt-28">
        <header className="flex h-8 items-center justify-between gap-x-4">
          <h2 className="text-base font-medium">Activity</h2>
        </header>

        {backupRuns.length > 0 || context.backupRestores.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filters.policy ?? 'all'}
              onValueChange={(value) => setFilter('policy', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All policies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All policies</SelectItem>
                {backupConfigs.map((policy) => (
                  <SelectItem key={policy.id} value={policy.id}>
                    {policy.name}
                  </SelectItem>
                ))}
                {filters.policy &&
                !backupConfigs.some(
                  (policy) => policy.id === filters.policy,
                ) ? (
                  <SelectItem value={filters.policy}>Deleted policy</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <Select
              value={filters.type ?? 'all'}
              onValueChange={(value) => setFilter('type', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="backup">
                  <ArrowDownIcon />
                  Backup
                </SelectItem>
                <SelectItem value="restore">
                  <Undo2Icon />
                  Restore
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.environment ?? 'all'}
              onValueChange={(value) => setFilter('environment', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All environments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All environments</SelectItem>
                {context.environments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.id}>
                    <EnvironmentDot color={environment.color} />
                    {environment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.status ?? 'all'}
              onValueChange={(value) => setFilter('status', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="queued">
                  <BackupStatusIcon status="queued" />
                  Queued
                </SelectItem>
                <SelectItem value="running">
                  <BackupStatusIcon status="running" />
                  Running
                </SelectItem>
                <SelectItem value="succeeded">
                  <BackupStatusIcon status="succeeded" />
                  Succeeded
                </SelectItem>
                <SelectItem value="failed">
                  <BackupStatusIcon status="failed" />
                  Failed
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.server ?? 'all'}
              onValueChange={(value) => setFilter('server', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All servers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All servers</SelectItem>
                {context.servers.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    <ServerAvatar
                      name={server.name}
                      status={server.status}
                      size="sm"
                    />
                    {server.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.time ?? 'all'}
              onValueChange={(value) => setFilter('time', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All dates" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All dates</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            {Object.values(filters).some(
              (value) => value && value !== 'all',
            ) ? (
              <Button variant="ghost" onClick={resetFilters}>
                Reset filters
              </Button>
            ) : null}
          </div>
        ) : null}

        {runs.length > 0 ? (
          <ul
            className="scrollbar overflow-x-auto rounded-xl border bg-card text-card-foreground"
            aria-label="Backup activity"
          >
            {runs.map(({ type, record, source }) => {
              const run = source
              const policy = backupConfigs.find(
                (config) => config.id === run?.configId,
              )
              const environment = context.environments.find(
                (item) => item.id === record.environmentId,
              )
              const started = record.startedAt ?? record.createdAt
              return (
                <li
                  key={`${type}:${record.id}`}
                  data-backup-activity={type}
                  className="flex h-11 min-w-[36rem] items-center gap-4 border-b px-4 text-sm whitespace-nowrap last:border-b-0 hover:bg-muted/50 md:min-w-[52rem]"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        role="status"
                        aria-label={`${type === 'backup' ? 'Backup' : 'Restore'} ${record.status}`}
                        className="inline-flex w-fit"
                      >
                        <BackupStatusIcon status={record.status} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {formatStatus(record.status)}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary">
                        {type === 'backup' ? (
                          <ArrowDownIcon data-icon="inline-start" />
                        ) : (
                          <Undo2Icon data-icon="inline-start" />
                        )}
                        {type === 'backup' ? 'Backup' : 'Restore'}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Type</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="shrink-0 font-mono text-[13px] font-medium">
                        {record.id.slice(0, 7)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {type === 'backup' ? 'Backup ID' : 'Restore ID'}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {policy ? (
                        <Link
                          to="/$teamSlug/projects/$projectName/backups"
                          params={{ teamSlug, projectName }}
                          search={{ ...filters, policy: policy.id }}
                          hash="activity"
                          className="min-w-20 max-w-48 truncate text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {policy.name}
                        </Link>
                      ) : (
                        <span className="min-w-20 max-w-48 truncate text-muted-foreground">
                          Deleted policy
                        </span>
                      )}
                    </TooltipTrigger>
                    <TooltipContent>Policy</TooltipContent>
                  </Tooltip>
                  <BackupTimestamp value={started} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        to="/$teamSlug/projects/$projectName/backups"
                        params={{ teamSlug, projectName }}
                        search={{
                          ...filters,
                          environment: record.environmentId,
                        }}
                        aria-label="Filter history by environment"
                        className="inline-flex min-w-16 max-w-32 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <EnvironmentDot
                          color={
                            environment?.color ??
                            run?.environmentColor ??
                            'neutral'
                          }
                        />
                        <span className="truncate">
                          {environment?.name ??
                            run?.environmentName ??
                            'Unknown environment'}
                        </span>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>Environment</TooltipContent>
                  </Tooltip>
                  {type === 'backup' &&
                  run?.configId &&
                  latestBackupRuns.get(run.configId)?.id === run.id ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary">Latest</Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        Latest backup for this policy
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <div className="ml-auto shrink-0">
                    <ButtonGroup
                      className="-mr-2 shrink-0"
                      aria-label="Operation actions"
                    >
                      {canManage && type === 'backup' && run ? (
                        <BackupRunRestoreActions
                          projectId={context.project.id}
                          policyName={policy?.name}
                          targetServerName={
                            context.servers.find(
                              (server) =>
                                server.id === environment?.effectiveServerId,
                            )?.name ?? 'No server assigned'
                          }
                          targetServerStatus={
                            context.servers.find(
                              (server) =>
                                server.id === environment?.effectiveServerId,
                            )?.status
                          }
                          artifacts={run.artifacts}
                          disabled={
                            actionBusy ||
                            context.backupRestores.some(
                              (restore) =>
                                restore.environmentId === run.environmentId &&
                                ['queued', 'running'].includes(restore.status),
                            )
                          }
                          restoringRunId={restoringRunId}
                          run={run}
                          onRestore={restoreBackup}
                        />
                      ) : null}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label={
                              type === 'backup'
                                ? 'Backup actions'
                                : 'Restore actions'
                            }
                          >
                            <EllipsisVerticalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {type === 'restore' ? (
                            <DropdownMenuItem
                              onSelect={() => setDetailsRestore(record)}
                            >
                              Details
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            onSelect={() =>
                              setLogOperation({
                                type,
                                id: record.id,
                                errorMessage: record.errorMessage,
                              })
                            }
                          >
                            {type === 'backup' ? 'Backup logs' : 'Restore logs'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ButtonGroup>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty className="min-h-60 border bg-card text-card-foreground">
            <EmptyHeader>
              <EmptyTitle>
                {backupRuns.length || context.backupRestores.length
                  ? 'No matching activity.'
                  : 'No backup history yet.'}
              </EmptyTitle>
              <EmptyDescription>
                Run a policy or wait for its next scheduled backup. Clear
                filters to see other activity.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
      <BackupJobLogs
        operation={logOperation}
        teamSlug={teamSlug}
        onClose={() => setLogOperation(null)}
      />
    </>
  )
}
