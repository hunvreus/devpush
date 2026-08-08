import { Link, useParams, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  BanIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleCheckIcon,
  ClockIcon,
  CircleXIcon,
  PencilIcon,
  LoaderIcon,
  LockIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ResourceAvatar } from '@/components/resource-avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import { getErrorMessage } from '@/lib/error-message'
import { setProjectContextQueryData } from '@/lib/project-context-query'
import { cn } from '@/lib/utils'
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
} from '@/server/projects/service'

type BackupFilters = {
  environment?: string
  server?: string
  status?: string
  time?: string
}

type BackupPolicyDraft = {
  accessKeyId: string
  bucket: string
  clearSecretAccessKey: boolean
  cron: string
  databaseDumps: ProjectBackupConfig['databaseDumps']
  enabled: boolean
  endpoint: string
  environmentId: string
  localRetentionCount: string
  localRetentionDays: string
  localRetentionMaxStorageGb: string
  name: string
  prefix: string
  region: string
  remoteRetentionEnabled: boolean
  remoteRetentionCount: string
  remoteRetentionDays: string
  remoteRetentionMaxStorageGb: string
  secretAccessKey: string
  volumeMode: 'none' | 'allNamed' | 'selected'
  volumeNames: Array<string>
}

type BackupPolicyErrorSection =
  | 'general'
  | 'destination'
  | 'retention'
  | 'volumes'
  | 'databases'
  | 'danger'

type BackupPolicyErrorField =
  | 'name'
  | 'environment'
  | 'schedule'
  | 'bucket'
  | 'endpoint'
  | 'accessKeyId'
  | 'secretAccessKey'
  | 'retention'
  | 'volumes'
  | 'databases'
  | 'danger'

const cronPresets = [
  { label: 'Daily at 02:00 UTC', value: '0 2 * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Weekly on Sunday (UTC)', value: '0 2 * * 0' },
  { label: 'Monthly on the 1st (UTC)', value: '0 2 1 * *' },
]

const backupDetailSections = [
  { id: 'general', label: 'General' },
  { id: 'destination', label: 'Remote backups' },
  { id: 'retention', label: 'Retention' },
  { id: 'volumes', label: 'Volumes' },
  { id: 'databases', label: 'Databases' },
  { id: 'danger', label: 'Danger' },
]

const databaseDumpPresets = [
  {
    label: 'Postgres',
    service: 'postgres',
    command: 'pg_dumpall -U "$POSTGRES_USER" | gzip',
  },
  {
    label: 'MySQL',
    service: 'mysql',
    command:
      'mysqldump --all-databases -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" | gzip',
  },
  {
    label: 'MariaDB',
    service: 'mariadb',
    command:
      'mariadb-dump --all-databases -u "$MARIADB_USER" -p"$MARIADB_PASSWORD" | gzip',
  },
]

function getSchedulePresetValue(cron: string) {
  return cronPresets.some((preset) => preset.value === cron) ? cron : 'custom'
}

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
  const [backupConfigs, setBackupConfigs] = useState(context.backupConfigs)
  const [backupRuns, setBackupRuns] = useState(context.backupRuns)
  const [savingPolicyId, setSavingPolicyId] = useState<string | null>(null)
  const [runningBackupId, setRunningBackupId] = useState<string | null>(null)
  const [restoringArtifactId, setRestoringArtifactId] = useState<string | null>(
    null,
  )
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
    void router.navigate({
      to: '/$teamSlug/projects/$projectName/backups',
      params: {
        teamSlug,
        projectName,
      },
      search: (current) => ({
        ...current,
        [key]: value === 'all' ? undefined : value,
      }),
    })
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
      setProjectContextQueryData(queryClient, nextContext)
      setBackupConfigs(nextContext.backupConfigs)
      setBackupRuns(nextContext.backupRuns)
      toast.success(message)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save backup policies.'))
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
    const nextConfigs = backupConfigs.map((item) =>
      item.id === backup.id ? { ...item, enabled } : item,
    )
    await updateBackupConfigs(
      nextConfigs,
      enabled ? 'Backup policy enabled.' : 'Backup policy disabled.',
      backup.id,
    )
  }

  async function deletePolicy(backup: ProjectBackupConfig) {
    const nextConfigs = backupConfigs.filter((item) => item.id !== backup.id)
    await updateBackupConfigs(nextConfigs, 'Backup policy deleted.', backup.id)
  }

  async function runBackup(backup: ProjectBackupConfig) {
    setRunningBackupId(backup.id)

    try {
      const nextContext = await runProjectBackup({
        data: {
          teamSlug,
          projectName,
          backupConfigId: backup.id,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
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
    restoreCommand,
    run,
    targetService,
    targetVolume,
  }: {
    artifact: ProjectBackupArtifact
    restoreCommand?: string
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
                    restoreCommand: restoreCommand ?? '',
                  },
                ],
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      setBackupConfigs(nextContext.backupConfigs)
      setBackupRuns(nextContext.backupRuns)
      toast.success('Restore queued.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to queue restore.'))
    } finally {
      setRestoringArtifactId(null)
    }
  }

  return (
    <>
      <header>
        <h1 className="flex items-center gap-x-3 text-2xl font-medium">
          <Link
            to="/$teamSlug/projects/$projectName"
            params={{ teamSlug, projectName }}
            className="shrink-0"
          >
            <ResourceAvatar
              name={context.project.name}
              src={context.project.avatarUrl ?? undefined}
              color={context.project.color}
              size="md"
            />
          </Link>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <span className="truncate">Backups</span>
        </h1>
      </header>

      {backupConfigs.length === 0 ? (
        <Empty className="min-h-60 border bg-card text-card-foreground shadow-sm">
          <EmptyHeader>
            <EmptyTitle>No backup policies yet.</EmptyTitle>
            <EmptyDescription>
              Create a backup policy for a specific environment.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <BackupPolicyDialog
              context={context}
              teamSlug={teamSlug}
              projectName={projectName}
              backupConfigs={backupConfigs}
              onSaved={setBackupConfigs}
            >
              <Button disabled={context.environments.length === 0}>
                <PlusIcon data-icon="inline-start" />
                Create policy
              </Button>
            </BackupPolicyDialog>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <section className="space-y-4">
            <header className="flex h-8 items-center justify-between gap-x-4">
              <h2 className="text-base font-medium">Backup policies</h2>
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
            </header>
            <ul>
              {backupConfigs.map((backup) => {
                const environment = context.environments.find(
                  (item) => item.id === backup.environmentId,
                )
                const latestRun =
                  backupRuns.find(
                    (run) => run.environmentId === backup.environmentId,
                  ) ?? null

                const isSaving = savingPolicyId === backup.id

                return (
                  <li
                    key={backup.id}
                    className="flex h-12 items-center gap-4 border border-b-0 px-4 text-sm first:rounded-t-xl last:rounded-b-xl last:border-b hover:bg-muted/50"
                  >
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
                    <div className="ml-auto flex shrink-0 items-center">
                      <BackupPolicyActions
                        disabled={isSaving}
                        enabled={backup.enabled}
                        onDelete={() => void deletePolicy(backup)}
                        onRun={() => void runBackup(backup)}
                        onToggle={() =>
                          void setPolicyEnabled(backup, !backup.enabled)
                        }
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="space-y-4">
            <header className="flex h-8 items-center justify-between gap-x-4">
              <h2 className="text-base font-medium">Backup runs</h2>
              <Button
                disabled={
                  backupConfigs.length === 0 || runningBackupId !== null
                }
                onClick={() => {
                  void runBackup(backupConfigs[0])
                }}
              >
                {runningBackupId ? (
                  <LoaderIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : null}
                Run backup
              </Button>
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
              <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
                <div className="grid min-h-12 grid-cols-[1.1fr_1fr_1fr_1fr_1fr_2rem] items-center border-b px-4 py-2 text-sm font-medium">
                  <span>Status</span>
                  <span>Environment</span>
                  <span>Server</span>
                  <span>Artifacts</span>
                  <span>Started</span>
                  <span />
                </div>
                {runs.map((run) => (
                  <div
                    key={run.id}
                    className="grid min-h-12 grid-cols-[1.1fr_1fr_1fr_1fr_1fr_2rem] items-center border-b px-4 py-2 text-sm last:border-b-0"
                  >
                    <span className="inline-flex items-center gap-2">
                      <BackupStatusIcon status={run.status} />
                      {formatStatus(run.status)}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <EnvironmentDot color={run.environmentColor} />
                      {run.environmentName}
                    </span>
                    <span className="text-muted-foreground">
                      {run.serverName ?? 'Unknown server'}
                    </span>
                    <span className="text-muted-foreground">
                      {formatBackupArtifacts(run.artifacts)}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDate(run.startedAt ?? run.createdAt)}
                    </span>
                    <BackupRunRestoreActions
                      artifacts={run.artifacts}
                      composeServices={
                        context.composeMetadata?.services ??
                        context.routes.map((route) => route.service)
                      }
                      composeVolumes={context.composeMetadata?.volumes ?? []}
                      disabled={restoringArtifactId !== null}
                      restoringArtifactId={restoringArtifactId}
                      run={run}
                      onRestore={(input) => void restoreArtifact(input)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <Empty className="min-h-60 border bg-card text-card-foreground shadow-sm">
                <EmptyHeader>
                  <EmptyTitle>No backup runs yet.</EmptyTitle>
                  <EmptyDescription>
                    Trigger a backup manually or wait for the next scheduled
                    run.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    disabled={
                      backupConfigs.length === 0 || runningBackupId !== null
                    }
                    onClick={() => {
                      void runBackup(backupConfigs[0])
                    }}
                  >
                    {runningBackupId ? (
                      <LoaderIcon
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : null}
                    Run backup
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </section>
        </>
      )}
    </>
  )
}

export function ProjectBackupDetails({
  backupId,
  context,
}: {
  backupId: string
  context: ProjectContext
}) {
  const params = useParams({ strict: false })
  const router = useRouter()
  const queryClient = useQueryClient()
  const teamSlug =
    typeof params.teamSlug === 'string' ? params.teamSlug : context.team.slug
  const projectName =
    typeof params.projectName === 'string'
      ? params.projectName
      : context.project.name
  const [backupConfigs, setBackupConfigs] = useState(context.backupConfigs)
  const backup = backupConfigs.find((item) => item.id === backupId)
  const [name, setName] = useState(backup?.name ?? '')
  const [environmentId, setEnvironmentId] = useState(
    backup?.environmentId ?? context.environments.at(0)?.id ?? '',
  )
  const [enabled, setEnabled] = useState(backup?.enabled ?? true)
  const [cron, setCron] = useState(backup?.schedule.cron ?? '0 2 * * *')
  const [schedulePresetValue, setSchedulePresetValue] = useState(
    getSchedulePresetValue(backup?.schedule.cron ?? '0 2 * * *'),
  )
  const [bucket, setBucket] = useState(backup?.destination.bucket ?? '')
  const [region, setRegion] = useState(backup?.destination.region ?? '')
  const [endpoint, setEndpoint] = useState(backup?.destination.endpoint ?? '')
  const [prefix, setPrefix] = useState(backup?.destination.prefix ?? '')
  const [accessKeyId, setAccessKeyId] = useState(
    backup?.destination.accessKeyId ?? '',
  )
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [clearSecretAccessKey, setClearSecretAccessKey] = useState(false)
  const [isEditingSecretAccessKey, setIsEditingSecretAccessKey] = useState(
    !backup?.destination.secretAccessKeyPreview,
  )
  const [localRetentionCount, setLocalRetentionCount] = useState(
    String(backup?.retention.local.count ?? 7),
  )
  const [localRetentionDays, setLocalRetentionDays] = useState(
    String(backup?.retention.local.days ?? 0),
  )
  const [localRetentionMaxStorageGb, setLocalRetentionMaxStorageGb] = useState(
    String(backup?.retention.local.maxStorageGb ?? 0),
  )
  const [remoteRetentionEnabled, setRemoteRetentionEnabled] = useState(
    backup?.retention.remote.enabled ?? false,
  )
  const [remoteRetentionCount, setRemoteRetentionCount] = useState(
    String(backup?.retention.remote.count ?? 7),
  )
  const [remoteRetentionDays, setRemoteRetentionDays] = useState(
    String(backup?.retention.remote.days ?? 0),
  )
  const [remoteRetentionMaxStorageGb, setRemoteRetentionMaxStorageGb] =
    useState(String(backup?.retention.remote.maxStorageGb ?? 0))
  const [volumeMode, setVolumeMode] = useState<
    'none' | 'allNamed' | 'selected'
  >(backup?.volumes.mode ?? 'allNamed')
  const [volumeNames, setVolumeNames] = useState(backup?.volumes.names ?? [])
  const [databaseDumps, setDatabaseDumps] = useState(
    backup?.databaseDumps ?? [],
  )
  const [fieldError, setFieldError] = useState<{
    field: BackupPolicyErrorField
    message: string
    section: BackupPolicyErrorSection
  } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const isCustomSchedule = schedulePresetValue === 'custom'
  const missingComposeFile = context.project.composePath === null
  const composeServices =
    context.composeMetadata?.services ??
    context.routes.map((route) => route.service)
  const composeVolumes = context.composeMetadata?.volumes ?? []
  const databaseServiceOptions = getDatabaseServiceOptions({
    services: composeServices,
    databaseDumps,
  })
  const volumeOptions = Array.from(
    new Set([...composeVolumes, ...volumeNames]),
  ).sort()
  const hasNamedVolumes = volumeOptions.length > 0
  const hasChanges = backup
    ? JSON.stringify(getBackupDraft()) !== JSON.stringify(toBackupDraft(backup))
    : false

  useEffect(() => {
    setBackupConfigs(context.backupConfigs)
  }, [context.backupConfigs])

  useEffect(() => {
    if (!backup) {
      return
    }
    setName(backup.name)
    setEnvironmentId(backup.environmentId)
    setEnabled(backup.enabled)
    setCron(backup.schedule.cron)
    setSchedulePresetValue(getSchedulePresetValue(backup.schedule.cron))
    setBucket(backup.destination.bucket)
    setRegion(backup.destination.region ?? '')
    setEndpoint(backup.destination.endpoint ?? '')
    setPrefix(backup.destination.prefix ?? '')
    setAccessKeyId(backup.destination.accessKeyId ?? '')
    setSecretAccessKey('')
    setClearSecretAccessKey(false)
    setIsEditingSecretAccessKey(!backup.destination.secretAccessKeyPreview)
    setLocalRetentionCount(String(backup.retention.local.count))
    setLocalRetentionDays(String(backup.retention.local.days))
    setLocalRetentionMaxStorageGb(String(backup.retention.local.maxStorageGb))
    setRemoteRetentionEnabled(backup.retention.remote.enabled)
    setRemoteRetentionCount(String(backup.retention.remote.count))
    setRemoteRetentionDays(String(backup.retention.remote.days))
    setRemoteRetentionMaxStorageGb(String(backup.retention.remote.maxStorageGb))
    setVolumeMode(backup.volumes.mode)
    setVolumeNames(backup.volumes.names)
    setDatabaseDumps(backup.databaseDumps)
    setFieldError(null)
  }, [backup])

  useEffect(() => {
    if (!hasNamedVolumes && volumeMode !== 'none') {
      setVolumeMode('none')
      setVolumeNames([])
    }
  }, [hasNamedVolumes, volumeMode])

  if (!backup) {
    return (
      <Empty className="min-h-60 border bg-card text-card-foreground shadow-sm">
        <EmptyHeader>
          <EmptyTitle>Backup policy not found.</EmptyTitle>
          <EmptyDescription>
            This backup policy may have been deleted.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link
              to="/$teamSlug/projects/$projectName/backups"
              params={{ teamSlug, projectName }}
            >
              Back to backups
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const currentBackup = backup
  const backupIdValue = currentBackup.id

  function getBackupDraft(): BackupPolicyDraft {
    return {
      name,
      environmentId,
      enabled,
      cron,
      bucket,
      region,
      endpoint,
      prefix,
      accessKeyId,
      secretAccessKey,
      clearSecretAccessKey,
      localRetentionCount,
      localRetentionDays,
      localRetentionMaxStorageGb,
      remoteRetentionEnabled,
      remoteRetentionCount,
      remoteRetentionDays,
      remoteRetentionMaxStorageGb,
      volumeMode,
      volumeNames,
      databaseDumps,
    }
  }

  function resetDraft() {
    setName(currentBackup.name)
    setEnvironmentId(currentBackup.environmentId)
    setEnabled(currentBackup.enabled)
    setCron(currentBackup.schedule.cron)
    setSchedulePresetValue(getSchedulePresetValue(currentBackup.schedule.cron))
    setBucket(currentBackup.destination.bucket)
    setRegion(currentBackup.destination.region ?? '')
    setEndpoint(currentBackup.destination.endpoint ?? '')
    setPrefix(currentBackup.destination.prefix ?? '')
    setAccessKeyId(currentBackup.destination.accessKeyId ?? '')
    setSecretAccessKey('')
    setClearSecretAccessKey(false)
    setIsEditingSecretAccessKey(
      !currentBackup.destination.secretAccessKeyPreview,
    )
    setLocalRetentionCount(String(currentBackup.retention.local.count))
    setLocalRetentionDays(String(currentBackup.retention.local.days))
    setLocalRetentionMaxStorageGb(
      String(currentBackup.retention.local.maxStorageGb),
    )
    setRemoteRetentionEnabled(currentBackup.retention.remote.enabled)
    setRemoteRetentionCount(String(currentBackup.retention.remote.count))
    setRemoteRetentionDays(String(currentBackup.retention.remote.days))
    setRemoteRetentionMaxStorageGb(
      String(currentBackup.retention.remote.maxStorageGb),
    )
    setVolumeMode(currentBackup.volumes.mode)
    setVolumeNames(currentBackup.volumes.names)
    setDatabaseDumps(currentBackup.databaseDumps)
    setFieldError(null)
  }

  async function save() {
    const trimmedName = name.trim()
    const trimmedCron = cron.trim()
    const trimmedBucket = bucket.trim()
    const trimmedEndpoint = endpoint.trim()
    const trimmedAccessKeyId = accessKeyId.trim()
    const trimmedSecretAccessKey = secretAccessKey.trim()
    const selectedVolumeNames = volumeNames
      .map((item) => item.trim())
      .filter(Boolean)
    const normalizedRetention = {
      local: {
        count: Number(localRetentionCount),
        days: Number(localRetentionDays),
        maxStorageGb: Number(localRetentionMaxStorageGb),
      },
      remote: {
        enabled: remoteRetentionEnabled,
        count: Number(remoteRetentionCount),
        days: Number(remoteRetentionDays),
        maxStorageGb: Number(remoteRetentionMaxStorageGb),
      },
    }
    const normalizedDumps = databaseDumps.map((dump) => ({
      service: dump.service.trim(),
      command: dump.command.trim(),
    }))

    if (!trimmedName) {
      setFieldError({
        field: 'name',
        message: 'Backup policy name is required.',
        section: 'general',
      })
      return
    }

    if (!environmentId) {
      setFieldError({
        field: 'environment',
        message: 'Select an environment.',
        section: 'general',
      })
      return
    }

    if (!isCronSchedule(trimmedCron)) {
      setFieldError({
        field: 'schedule',
        message: 'Use a five-field cron schedule, e.g. 0 2 * * *.',
        section: 'general',
      })
      return
    }

    if (remoteRetentionEnabled && !trimmedBucket) {
      setFieldError({
        field: 'bucket',
        message: 'Backup bucket is required.',
        section: 'destination',
      })
      return
    }

    if (
      remoteRetentionEnabled &&
      trimmedAccessKeyId &&
      !trimmedSecretAccessKey &&
      (!currentBackup.destination.secretAccessKeyPreview ||
        clearSecretAccessKey)
    ) {
      setFieldError({
        field: 'secretAccessKey',
        message: 'Remote backup secret access key is required.',
        section: 'destination',
      })
      return
    }

    if (
      remoteRetentionEnabled &&
      !trimmedAccessKeyId &&
      trimmedSecretAccessKey
    ) {
      setFieldError({
        field: 'accessKeyId',
        message: 'Remote backup access key ID is required.',
        section: 'destination',
      })
      return
    }

    if (remoteRetentionEnabled && trimmedEndpoint && !isUrl(trimmedEndpoint)) {
      setFieldError({
        field: 'endpoint',
        message: 'Endpoint must be a valid URL.',
        section: 'destination',
      })
      return
    }

    if (!isValidRetention(normalizedRetention)) {
      setFieldError({
        field: 'retention',
        message:
          'Retention values must be non-negative numbers. Backup count and days must be whole numbers.',
        section: 'retention',
      })
      return
    }

    if (volumeMode === 'selected' && volumeOptions.length === 0) {
      setFieldError({
        field: 'volumes',
        message: 'No named Compose volumes were detected for this project.',
        section: 'volumes',
      })
      return
    }

    if (volumeMode === 'selected' && selectedVolumeNames.length === 0) {
      setFieldError({
        field: 'volumes',
        message: 'Select at least one named volume or choose no volumes.',
        section: 'volumes',
      })
      return
    }

    const incompleteDump = normalizedDumps.find(
      (dump) => !dump.service || !dump.command,
    )
    if (incompleteDump) {
      setFieldError({
        field: 'databases',
        message: 'Database dumps must include service and command.',
        section: 'databases',
      })
      return
    }

    setIsSaving(true)

    const nextConfigs = backupConfigs.map((item) =>
      item.id === backupIdValue
        ? {
            ...item,
            name: trimmedName,
            environmentId,
            enabled,
            schedule: { cron: trimmedCron },
            destination: {
              bucket: trimmedBucket,
              region: region.trim() || undefined,
              endpoint: trimmedEndpoint || undefined,
              prefix: prefix.trim() || undefined,
              accessKeyId: trimmedAccessKeyId || undefined,
              secretAccessKey: trimmedSecretAccessKey || undefined,
              clearSecretAccessKey,
            },
            retention: normalizedRetention,
            volumes: {
              mode: volumeMode,
              names: volumeMode === 'selected' ? selectedVolumeNames : [],
            },
            databaseDumps: normalizedDumps,
          }
        : item,
    )

    try {
      const nextContext = await saveProjectBackupConfigs({
        data: {
          teamSlug,
          projectName,
          backupConfigs: nextConfigs,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      setBackupConfigs(nextContext.backupConfigs)
      toast.success('Backup policy saved.')
      setFieldError(null)
    } catch (error) {
      setFieldError({
        field: 'name',
        message: getErrorMessage(error, 'Unable to save backup policy.'),
        section: 'general',
      })
    } finally {
      setIsSaving(false)
    }
  }

  async function deletePolicy() {
    setIsSaving(true)
    const nextConfigs = backupConfigs.filter(
      (item) => item.id !== backupIdValue,
    )

    try {
      const nextContext = await saveProjectBackupConfigs({
        data: {
          teamSlug,
          projectName,
          backupConfigs: nextConfigs,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      setBackupConfigs(nextContext.backupConfigs)
      toast.success('Backup policy deleted.')
      void router.navigate({
        to: '/$teamSlug/projects/$projectName/backups',
        params: { teamSlug, projectName },
      })
    } catch (error) {
      setFieldError({
        field: 'danger',
        message: getErrorMessage(error, 'Unable to delete backup policy.'),
        section: 'danger',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="flex items-center gap-x-3 text-2xl font-medium">
          <Link
            to="/$teamSlug/projects/$projectName"
            params={{ teamSlug, projectName }}
            className="shrink-0"
          >
            <ResourceAvatar
              name={context.project.name}
              src={context.project.avatarUrl ?? undefined}
              color={context.project.color}
              size="md"
            />
          </Link>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <Link
            to="/$teamSlug/projects/$projectName/backups"
            params={{ teamSlug, projectName }}
            className="truncate hover:underline"
          >
            Backups
          </Link>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <span className="truncate">{backup.name}</span>
        </h1>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <div className="space-y-8">
          <BackupPolicySection
            id="general"
            title="General"
            description="Name, environment, and schedule for this backup policy."
            footer={
              <BackupPolicySaveActions
                hasChanges={hasChanges}
                isSaving={isSaving}
                onCancel={resetDraft}
                onSave={save}
              />
            }
          >
            <FieldGroup>
              <Field orientation="horizontal" className="justify-between">
                <div className="space-y-1">
                  <FieldLabel htmlFor={`backup-policy-enabled-${backup.id}`}>
                    Status
                  </FieldLabel>
                  <FieldDescription>
                    Enabled policies are eligible for scheduled backup jobs.
                    Paused policies keep their configuration but do not enqueue
                    backups.
                  </FieldDescription>
                </div>
                <Switch
                  id={`backup-policy-enabled-${backup.id}`}
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </Field>

              <Field
                data-invalid={fieldError?.field === 'name' ? true : undefined}
              >
                <FieldLabel htmlFor={`backup-policy-name-${backup.id}`}>
                  Name
                </FieldLabel>
                <Input
                  id={`backup-policy-name-${backup.id}`}
                  aria-invalid={fieldError?.field === 'name'}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                {fieldError?.field === 'name' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </Field>

              <Field
                data-invalid={
                  fieldError?.field === 'environment' ? true : undefined
                }
              >
                <FieldLabel>Environment</FieldLabel>
                <Select value={environmentId} onValueChange={setEnvironmentId}>
                  <SelectTrigger
                    className="w-full"
                    aria-invalid={fieldError?.field === 'environment'}
                  >
                    <SelectValue placeholder="Select environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {context.environments.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        <span className="inline-flex items-center gap-2">
                          <EnvironmentDot color={item.color} />
                          {item.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldError?.field === 'environment' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </Field>

              <Field
                data-invalid={
                  fieldError?.field === 'schedule' ? true : undefined
                }
              >
                <FieldLabel>Schedule</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    value={schedulePresetValue}
                    onValueChange={(value) => {
                      setSchedulePresetValue(value)
                      if (value !== 'custom') {
                        setCron(value)
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Preset" />
                    </SelectTrigger>
                    <SelectContent>
                      {cronPresets.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">
                        Custom (cron schedule)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <InputGroup
                    className={
                      isCustomSchedule
                        ? undefined
                        : 'bg-accent/50 text-muted-foreground'
                    }
                  >
                    <InputGroupInput
                      aria-invalid={fieldError?.field === 'schedule'}
                      value={cron}
                      placeholder="0 2 * * *"
                      readOnly={!isCustomSchedule}
                      onChange={(event) => setCron(event.target.value)}
                    />
                    {isCustomSchedule ? null : (
                      <InputGroupAddon align="inline-end">
                        <LockIcon />
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                </div>
                <FieldDescription>Backup schedules use UTC.</FieldDescription>
                {fieldError?.field === 'schedule' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </Field>
            </FieldGroup>
          </BackupPolicySection>

          <BackupPolicySection
            id="destination"
            title="Remote backups"
            description="Upload backup artifacts to remote object storage."
            footer={
              <BackupPolicySaveActions
                hasChanges={hasChanges}
                isSaving={isSaving}
                onCancel={resetDraft}
                onSave={save}
              />
            }
          >
            <FieldGroup>
              <Field orientation="horizontal" className="justify-start">
                <Switch
                  id={`backup-remote-enabled-${backup.id}`}
                  checked={remoteRetentionEnabled}
                  onCheckedChange={setRemoteRetentionEnabled}
                />
                <FieldLabel htmlFor={`backup-remote-enabled-${backup.id}`}>
                  Enable remote backups
                </FieldLabel>
              </Field>
              <Field
                data-invalid={fieldError?.field === 'bucket' ? true : undefined}
              >
                <FieldLabel htmlFor={`backup-bucket-${backup.id}`}>
                  Bucket
                </FieldLabel>
                <Input
                  id={`backup-bucket-${backup.id}`}
                  aria-invalid={fieldError?.field === 'bucket'}
                  disabled={!remoteRetentionEnabled}
                  value={bucket}
                  placeholder="devpush-backups"
                  onChange={(event) => setBucket(event.target.value)}
                />
                {fieldError?.field === 'bucket' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </Field>
              <Field
                data-invalid={
                  fieldError?.field === 'endpoint' ? true : undefined
                }
              >
                <FieldLabel htmlFor={`backup-region-${backup.id}`}>
                  Region
                </FieldLabel>
                <FieldDescription>
                  Provider region, or auto for providers like R2 that do not
                  require a traditional region.
                </FieldDescription>
                <Input
                  id={`backup-region-${backup.id}`}
                  disabled={!remoteRetentionEnabled}
                  value={region}
                  placeholder="auto"
                  onChange={(event) => setRegion(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`backup-endpoint-${backup.id}`}>
                  Endpoint
                </FieldLabel>
                <FieldDescription>
                  Custom S3-compatible API endpoint. Leave empty for AWS S3.
                </FieldDescription>
                <Input
                  id={`backup-endpoint-${backup.id}`}
                  aria-invalid={fieldError?.field === 'endpoint'}
                  disabled={!remoteRetentionEnabled}
                  value={endpoint}
                  placeholder="https://example.r2.cloudflarestorage.com"
                  onChange={(event) => setEndpoint(event.target.value)}
                />
                {fieldError?.field === 'endpoint' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </Field>
              <Field
                data-invalid={
                  fieldError?.field === 'accessKeyId' ? true : undefined
                }
              >
                <FieldLabel htmlFor={`backup-prefix-${backup.id}`}>
                  Object prefix
                </FieldLabel>
                <Input
                  id={`backup-prefix-${backup.id}`}
                  disabled={!remoteRetentionEnabled}
                  value={prefix}
                  placeholder={getDefaultBackupPrefix(
                    context.project.id,
                    environmentId,
                    backup.id,
                  )}
                  onChange={(event) => setPrefix(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`backup-access-key-id-${backup.id}`}>
                  Access key ID
                </FieldLabel>
                <Input
                  id={`backup-access-key-id-${backup.id}`}
                  aria-invalid={fieldError?.field === 'accessKeyId'}
                  disabled={!remoteRetentionEnabled}
                  value={accessKeyId}
                  onChange={(event) => setAccessKeyId(event.target.value)}
                />
                {fieldError?.field === 'accessKeyId' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </Field>
              <Field
                data-invalid={
                  fieldError?.field === 'secretAccessKey' ? true : undefined
                }
              >
                <FieldLabel htmlFor={`backup-secret-access-key-${backup.id}`}>
                  Secret access key
                </FieldLabel>
                {isEditingSecretAccessKey ||
                !backup.destination.secretAccessKeyPreview ||
                clearSecretAccessKey ? (
                  <InputGroup>
                    <InputGroupInput
                      id={`backup-secret-access-key-${backup.id}`}
                      aria-invalid={fieldError?.field === 'secretAccessKey'}
                      disabled={!remoteRetentionEnabled}
                      value={secretAccessKey}
                      type="password"
                      placeholder={
                        backup.destination.secretAccessKeyPreview &&
                        !clearSecretAccessKey
                          ? 'Paste replacement value'
                          : undefined
                      }
                      onChange={(event) => {
                        setSecretAccessKey(event.target.value)
                        setClearSecretAccessKey(false)
                      }}
                    />
                    {backup.destination.secretAccessKeyPreview ? (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          onClick={() => {
                            setAccessKeyId(
                              currentBackup.destination.accessKeyId ?? '',
                            )
                            setSecretAccessKey('')
                            setClearSecretAccessKey(false)
                            setIsEditingSecretAccessKey(false)
                          }}
                        >
                          Cancel
                        </InputGroupButton>
                        <InputGroupButton
                          variant="destructive"
                          onClick={() => {
                            setAccessKeyId('')
                            setSecretAccessKey('')
                            setClearSecretAccessKey(true)
                          }}
                        >
                          Clear
                        </InputGroupButton>
                      </InputGroupAddon>
                    ) : null}
                  </InputGroup>
                ) : (
                  <InputGroup>
                    <InputGroupInput
                      id={`backup-secret-access-key-${backup.id}`}
                      disabled
                      value={backup.destination.secretAccessKeyPreview}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        onClick={() => setIsEditingSecretAccessKey(true)}
                        disabled={!remoteRetentionEnabled}
                      >
                        <PencilIcon />
                        Edit
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                )}
                <FieldDescription>
                  Stored encrypted. The saved secret cannot be viewed again;
                  edit it to replace the value.
                </FieldDescription>
                {fieldError?.field === 'secretAccessKey' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </Field>
            </FieldGroup>
          </BackupPolicySection>

          <BackupPolicySection
            id="retention"
            title="Retention"
            description="Limits retained local and remote backup generations by count, age, and storage."
            footer={
              <BackupPolicySaveActions
                hasChanges={hasChanges}
                isSaving={isSaving}
                onCancel={resetDraft}
                onSave={save}
              />
            }
          >
            <div className="grid gap-6">
              <RetentionFieldGroup
                title="Local backups"
                description="Applies to backup files kept on the server. A value of 0 disables that local limit."
                count={localRetentionCount}
                days={localRetentionDays}
                maxStorageGb={localRetentionMaxStorageGb}
                fieldError={fieldError?.field === 'retention'}
                onCountChange={setLocalRetentionCount}
                onDaysChange={setLocalRetentionDays}
                onMaxStorageGbChange={setLocalRetentionMaxStorageGb}
              />
              <RetentionFieldGroup
                title="Remote backups"
                description="Applies to uploaded remote backup objects. A value of 0 disables that remote limit."
                enabled={remoteRetentionEnabled}
                count={remoteRetentionCount}
                days={remoteRetentionDays}
                maxStorageGb={remoteRetentionMaxStorageGb}
                fieldError={fieldError?.field === 'retention'}
                onCountChange={setRemoteRetentionCount}
                onDaysChange={setRemoteRetentionDays}
                onMaxStorageGbChange={setRemoteRetentionMaxStorageGb}
              />
              {fieldError?.field === 'retention' ? (
                <FieldError>{fieldError.message}</FieldError>
              ) : null}
            </div>
          </BackupPolicySection>

          <BackupPolicySection
            id="volumes"
            title="Volume backups"
            description="Archive named Compose volumes for this environment."
            footer={
              missingComposeFile ? undefined : (
                <BackupPolicySaveActions
                  hasChanges={hasChanges}
                  isSaving={isSaving}
                  onCancel={resetDraft}
                  onSave={save}
                />
              )
            }
          >
            {missingComposeFile ? (
              <ComposeRequiredEmpty />
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
                  <Select
                    value={volumeMode}
                    onValueChange={(value) =>
                      setVolumeMode(value as 'none' | 'allNamed' | 'selected')
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No volumes</SelectItem>
                      <SelectItem value="allNamed" disabled={!hasNamedVolumes}>
                        All named volumes
                      </SelectItem>
                      <SelectItem value="selected" disabled={!hasNamedVolumes}>
                        Selected volumes
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <VolumeMultiSelect
                    disabled={volumeMode !== 'selected'}
                    options={volumeOptions}
                    onVolumeNamesChange={setVolumeNames}
                    volumeNames={volumeNames}
                  />
                </div>
                {fieldError?.section === 'volumes' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </div>
            )}
          </BackupPolicySection>

          <BackupPolicySection
            id="databases"
            title="Database dumps"
            description="Run database dump commands before the archive is uploaded."
            footer={
              missingComposeFile ? undefined : (
                <BackupPolicySaveActions
                  hasChanges={hasChanges}
                  isSaving={isSaving}
                  onCancel={resetDraft}
                  onSave={save}
                />
              )
            }
          >
            {missingComposeFile ? (
              <ComposeRequiredEmpty />
            ) : (
              <div className="space-y-4">
                {databaseDumps.length > 0 ? (
                  <div>
                    <div className="grid grid-cols-[180px_minmax(0,1fr)_2rem_2rem] gap-x-2 border-b pb-3 text-sm font-medium">
                      <span>Service</span>
                      <span>Command</span>
                      <span />
                      <span />
                    </div>
                    {databaseDumps.map((dump, index) => (
                      <div
                        key={index}
                        className="grid min-h-12 grid-cols-[180px_minmax(0,1fr)_2rem_2rem] items-start gap-x-2 border-b py-2 text-sm"
                      >
                        <Select
                          value={dump.service || undefined}
                          onValueChange={(value) => {
                            const nextDumps = [...databaseDumps]
                            nextDumps[index] = {
                              ...dump,
                              service: value,
                            }
                            setDatabaseDumps(nextDumps)
                          }}
                        >
                          <SelectTrigger
                            id={`backup-dump-service-${backup.id}-${index}`}
                            className="w-full"
                          >
                            <SelectValue placeholder="Select service" />
                          </SelectTrigger>
                          <SelectContent>
                            {databaseServiceOptions.length > 0 ? (
                              databaseServiceOptions.map((service) => (
                                <SelectItem key={service} value={service}>
                                  {service}
                                </SelectItem>
                              ))
                            ) : (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                No services detected.
                              </div>
                            )}
                          </SelectContent>
                        </Select>
                        <Input
                          className="font-mono text-[13px]"
                          id={`backup-dump-command-${backup.id}-${index}`}
                          value={dump.command}
                          placeholder="dump command | gzip"
                          onChange={(event) => {
                            const nextDumps = [...databaseDumps]
                            nextDumps[index] = {
                              ...dump,
                              command: event.target.value,
                            }
                            setDatabaseDumps(nextDumps)
                          }}
                        />
                        <DatabaseDumpPresetMenu
                          onSelect={(preset) => {
                            const nextDumps = [...databaseDumps]
                            nextDumps[index] = {
                              ...dump,
                              command: preset.command,
                            }
                            setDatabaseDumps(nextDumps)
                          }}
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          aria-label="Remove database dump"
                          onClick={() =>
                            setDatabaseDumps(
                              databaseDumps.filter(
                                (_, dumpIndex) => dumpIndex !== index,
                              ),
                            )
                          }
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty className="min-h-40 border-0">
                    <EmptyHeader>
                      <EmptyTitle>
                        {databaseServiceOptions.length > 0
                          ? 'No database dumps.'
                          : 'No services detected.'}
                      </EmptyTitle>
                      <EmptyDescription>
                        {databaseServiceOptions.length > 0
                          ? 'Volume archives may only be crash-consistent for live databases. Add dump commands for database services.'
                          : 'No Compose services are available for database dump commands.'}
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent className="flex-row justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={databaseServiceOptions.length === 0}
                        onClick={() =>
                          setDatabaseDumps([
                            ...databaseDumps,
                            {
                              service: databaseServiceOptions[0] ?? '',
                              command: '',
                            },
                          ])
                        }
                      >
                        <PlusIcon data-icon="inline-start" />
                        Add dump
                      </Button>
                    </EmptyContent>
                  </Empty>
                )}
                {databaseDumps.length > 0 ? (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={databaseServiceOptions.length === 0}
                      onClick={() =>
                        setDatabaseDumps([
                          ...databaseDumps,
                          {
                            service: databaseServiceOptions[0] ?? '',
                            command: '',
                          },
                        ])
                      }
                    >
                      <PlusIcon data-icon="inline-start" />
                      Add dump
                    </Button>
                  </div>
                ) : null}
                {fieldError?.section === 'databases' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </div>
            )}
          </BackupPolicySection>

          <BackupPolicySection
            id="danger"
            title="Danger"
            description="Delete this backup policy. Existing backup runs are kept."
          >
            <Button
              type="button"
              variant="destructive"
              onClick={deletePolicy}
              disabled={isSaving}
            >
              <TrashIcon data-icon="inline-start" />
              Delete policy
            </Button>
            {fieldError?.section === 'danger' ? (
              <FieldError>{fieldError.message}</FieldError>
            ) : null}
          </BackupPolicySection>
        </div>
        <aside className="hidden text-sm lg:block">
          <nav className="sticky top-[122px] flex flex-col gap-y-1">
            {backupDetailSections.map((section) => (
              <Button
                key={section.id}
                asChild
                variant="ghost"
                className={cn(
                  'justify-start',
                  section.id === 'danger'
                    ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                    : null,
                )}
              >
                <a href={`#${section.id}`}>{section.label}</a>
              </Button>
            ))}
          </nav>
        </aside>
      </div>
    </div>
  )
}

function ComposeRequiredEmpty() {
  return (
    <Empty className="min-h-40 border-0">
      <EmptyHeader>
        <EmptyTitle>No Compose file configured.</EmptyTitle>
        <EmptyDescription>
          Configure a Compose file before editing volume or database backups.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function VolumeMultiSelect({
  disabled,
  options,
  onVolumeNamesChange,
  volumeNames,
}: {
  disabled: boolean
  options: Array<string>
  onVolumeNamesChange: (value: Array<string>) => void
  volumeNames: Array<string>
}) {
  const [open, setOpen] = useState(false)
  const hasOptions = options.length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="min-h-9 justify-between font-normal"
          disabled={disabled || !hasOptions}
        >
          <span className="min-w-0 truncate">
            {volumeNames.length > 0
              ? volumeNames.join(', ')
              : hasOptions
                ? 'Select volumes'
                : 'No named volumes detected'}
          </span>
          <ChevronsUpDownIcon
            data-icon="inline-end"
            className="size-4 shrink-0 opacity-50"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No named volumes detected.</CommandEmpty>
            {hasOptions ? (
              <CommandGroup heading="Volumes">
                {options.map((volumeName) => {
                  const selected = volumeNames.includes(volumeName)

                  return (
                    <CommandItem
                      key={volumeName}
                      value={volumeName}
                      onSelect={() => {
                        onVolumeNamesChange(
                          selected
                            ? volumeNames.filter((item) => item !== volumeName)
                            : [...volumeNames, volumeName],
                        )
                      }}
                    >
                      <CheckIcon
                        className={cn(
                          'size-4',
                          selected ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="truncate font-mono text-[13px]">
                        {volumeName}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function DatabaseDumpPresetMenu({
  onSelect,
}: {
  onSelect: (preset: ProjectBackupConfig['databaseDumps'][number]) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Presets">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {databaseDumpPresets.map((preset) => (
          <DropdownMenuItem
            key={preset.label}
            onSelect={() => onSelect(preset)}
          >
            {preset.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BackupPolicyDialog({
  backupConfigs,
  children,
  context,
  onSaved,
  projectName,
  teamSlug,
}: {
  backupConfigs: Array<ProjectBackupConfig>
  children: ReactNode
  context: ProjectContext
  onSaved: (backupConfigs: Array<ProjectBackupConfig>) => void
  projectName: string
  teamSlug: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const firstEnvironmentId = context.environments[0]?.id ?? ''
  const [open, setOpen] = useState(false)
  const [id, setId] = useState(() => crypto.randomUUID())
  const [name, setName] = useState('')
  const [environmentId, setEnvironmentId] = useState(firstEnvironmentId)
  const [cron, setCron] = useState('0 2 * * *')
  const [schedulePresetValue, setSchedulePresetValue] = useState(
    getSchedulePresetValue('0 2 * * *'),
  )
  const [fieldError, setFieldError] = useState<{
    field: 'environment' | 'name' | 'schedule' | 'form'
    message: string
  } | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const isCustomSchedule = schedulePresetValue === 'custom'
  const defaultVolumeMode =
    (context.composeMetadata?.volumes.length ?? 0) > 0 ? 'allNamed' : 'none'

  useEffect(() => {
    if (!open) {
      return
    }

    const nextId = crypto.randomUUID()
    const nextEnvironmentId = firstEnvironmentId
    const environment = context.environments.find(
      (item) => item.id === nextEnvironmentId,
    )

    setId(nextId)
    setEnvironmentId(nextEnvironmentId)
    setName(`${environment?.name ?? 'Production'} backup`)
    setCron('0 2 * * *')
    setSchedulePresetValue(getSchedulePresetValue('0 2 * * *'))
    setFieldError(null)
  }, [context.environments, firstEnvironmentId, open])

  async function save() {
    const trimmedName = name.trim()
    const trimmedCron = cron.trim()

    if (!trimmedName) {
      setFieldError({
        field: 'name',
        message: 'Backup policy name is required.',
      })
      return
    }

    if (!environmentId) {
      setFieldError({ field: 'environment', message: 'Select an environment.' })
      return
    }

    if (!isCronSchedule(trimmedCron)) {
      setFieldError({
        field: 'schedule',
        message: 'Use a five-field cron schedule, e.g. 0 2 * * *.',
      })
      return
    }

    setIsSaving(true)

    const nextConfig: ProjectBackupConfig = {
      id,
      name: trimmedName,
      environmentId,
      enabled: true,
      schedule: { cron: trimmedCron },
      destination: {
        bucket: 'devpush-backups',
        prefix: getDefaultBackupPrefix(context.project.id, environmentId, id),
      },
      retention: {
        local: {
          count: 7,
          days: 0,
          maxStorageGb: 0,
        },
        remote: {
          enabled: false,
          count: 7,
          days: 0,
          maxStorageGb: 0,
        },
      },
      volumes: { mode: defaultVolumeMode, names: [] },
      databaseDumps: [],
    }

    const nextConfigs = [...backupConfigs, nextConfig]

    try {
      const nextContext = await saveProjectBackupConfigs({
        data: {
          teamSlug,
          projectName,
          backupConfigs: nextConfigs,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      onSaved(nextContext.backupConfigs)
      toast.success('Backup policy created.')
      setOpen(false)
      void router.navigate({
        to: '/$teamSlug/projects/$projectName/backups/$backupId',
        params: { teamSlug, projectName, backupId: nextConfig.id },
      })
    } catch (error) {
      setFieldError({
        field: 'form',
        message: getErrorMessage(error, 'Unable to save backup policy.'),
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create backup policy</DialogTitle>
          <DialogDescription>
            Configure when the agent should run a backup policy for one
            environment.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={fieldError?.field === 'name' ? true : undefined}>
            <FieldLabel htmlFor={`backup-name-${id}`}>Name</FieldLabel>
            <Input
              aria-invalid={fieldError?.field === 'name'}
              id={`backup-name-${id}`}
              value={name}
              placeholder="Production backup"
              onChange={(event) => {
                setName(event.target.value)
                if (fieldError?.field === 'name') {
                  setFieldError(null)
                }
              }}
            />
            {fieldError?.field === 'name' ? (
              <FieldError>{fieldError.message}</FieldError>
            ) : null}
          </Field>

          <Field
            data-invalid={
              fieldError?.field === 'environment' ? true : undefined
            }
          >
            <FieldLabel>Environment</FieldLabel>
            <Select
              value={environmentId}
              onValueChange={(value) => {
                setEnvironmentId(value)
                if (fieldError?.field === 'environment') {
                  setFieldError(null)
                }
              }}
            >
              <SelectTrigger
                aria-invalid={fieldError?.field === 'environment'}
                className="w-full"
              >
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                {context.environments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.id}>
                    <span className="inline-flex items-center gap-2">
                      <EnvironmentDot color={environment.color} />
                      {environment.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldError?.field === 'environment' ? (
              <FieldError>{fieldError.message}</FieldError>
            ) : null}
          </Field>

          <Field
            data-invalid={fieldError?.field === 'schedule' ? true : undefined}
          >
            <FieldLabel>Schedule</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={schedulePresetValue}
                onValueChange={(value) => {
                  setSchedulePresetValue(value)
                  if (fieldError?.field === 'schedule') {
                    setFieldError(null)
                  }
                  if (value !== 'custom') {
                    setCron(value)
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Preset" />
                </SelectTrigger>
                <SelectContent>
                  {cronPresets.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom (cron schedule)</SelectItem>
                </SelectContent>
              </Select>
              <InputGroup
                className={
                  isCustomSchedule
                    ? undefined
                    : 'bg-accent/50 text-muted-foreground'
                }
              >
                <InputGroupInput
                  aria-invalid={fieldError?.field === 'schedule'}
                  value={cron}
                  placeholder="0 2 * * *"
                  readOnly={!isCustomSchedule}
                  onChange={(event) => {
                    setCron(event.target.value)
                    if (fieldError?.field === 'schedule') {
                      setFieldError(null)
                    }
                  }}
                />
                {isCustomSchedule ? null : (
                  <InputGroupAddon align="inline-end">
                    <LockIcon />
                  </InputGroupAddon>
                )}
              </InputGroup>
            </div>
            <FieldDescription>Backup schedules use UTC.</FieldDescription>
            {fieldError?.field === 'schedule' ? (
              <FieldError>{fieldError.message}</FieldError>
            ) : null}
          </Field>

          {fieldError?.field === 'form' ? (
            <FieldError>{fieldError.message}</FieldError>
          ) : null}
        </FieldGroup>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={isSaving}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={save} disabled={isSaving}>
            {isSaving ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : null}
            Create policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RetentionFieldGroup({
  count,
  days,
  description,
  enabled = true,
  fieldError,
  maxStorageGb,
  onCountChange,
  onDaysChange,
  onEnabledChange,
  onMaxStorageGbChange,
  title,
}: {
  count: string
  days: string
  description: string
  enabled?: boolean
  fieldError: boolean
  maxStorageGb: string
  onCountChange: (value: string) => void
  onDaysChange: (value: string) => void
  onEnabledChange?: (value: boolean) => void
  onMaxStorageGbChange: (value: string) => void
  title: string
}) {
  return (
    <FieldSet>
      <FieldLegend>{title}</FieldLegend>
      <div className="flex items-start justify-between gap-4">
        <FieldDescription>{description}</FieldDescription>
        {onEnabledChange ? (
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            aria-label={`${title} enabled`}
          />
        ) : null}
      </div>
      <FieldGroup className="grid gap-3 sm:grid-cols-3">
        <Field data-invalid={fieldError ? true : undefined}>
          <FieldLabel>Number of backups to keep</FieldLabel>
          <Input
            aria-invalid={fieldError}
            disabled={!enabled}
            type="number"
            min={0}
            step={1}
            value={count}
            onChange={(event) => onCountChange(event.target.value)}
          />
        </Field>
        <Field data-invalid={fieldError ? true : undefined}>
          <FieldLabel>Days to keep backups</FieldLabel>
          <Input
            aria-invalid={fieldError}
            disabled={!enabled}
            type="number"
            min={0}
            step={1}
            value={days}
            onChange={(event) => onDaysChange(event.target.value)}
          />
        </Field>
        <Field data-invalid={fieldError ? true : undefined}>
          <FieldLabel>Maximum storage (GB)</FieldLabel>
          <Input
            aria-invalid={fieldError}
            disabled={!enabled}
            type="number"
            min={0}
            step="0.1"
            value={maxStorageGb}
            onChange={(event) => onMaxStorageGbChange(event.target.value)}
          />
        </Field>
      </FieldGroup>
    </FieldSet>
  )
}

function BackupPolicySection({
  children,
  description,
  footer,
  id,
  title,
}: {
  children: ReactNode
  description: string
  footer?: ReactNode
  id: string
  title: string
}) {
  return (
    <Card id={id} className="scroll-mt-8">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? (
        <CardFooter className="justify-end gap-x-2">{footer}</CardFooter>
      ) : null}
    </Card>
  )
}

function BackupPolicySaveActions({
  hasChanges,
  isSaving,
  onCancel,
  onSave,
}: {
  hasChanges: boolean
  isSaving: boolean
  onCancel: () => void
  onSave: () => Promise<void>
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={!hasChanges || isSaving}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        type="button"
        disabled={!hasChanges || isSaving}
        onClick={() => void onSave()}
      >
        {isSaving ? (
          <LoaderIcon data-icon="inline-start" className="animate-spin" />
        ) : null}
        Save
      </Button>
    </>
  )
}

function filterBackupRuns(
  runs: Array<ProjectBackupRun>,
  filters: BackupFilters,
) {
  const since = getSinceDate(filters.time)

  return runs.filter((run) => {
    if (filters.environment && run.environmentId !== filters.environment) {
      return false
    }
    if (filters.server && run.serverId !== filters.server) {
      return false
    }
    if (filters.status && run.status !== filters.status) {
      return false
    }
    if (since && new Date(run.createdAt) < since) {
      return false
    }
    return true
  })
}

function getSinceDate(time: string | undefined) {
  if (!time) {
    return null
  }
  const days = time === '24h' ? 1 : time === '7d' ? 7 : time === '30d' ? 30 : 0
  if (!days) {
    return null
  }
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

function BackupRunRestoreActions({
  artifacts,
  composeServices,
  composeVolumes,
  disabled,
  restoringArtifactId,
  run,
  onRestore,
}: {
  artifacts: Array<ProjectBackupArtifact>
  composeServices: Array<string>
  composeVolumes: Array<string>
  disabled: boolean
  restoringArtifactId: string | null
  run: ProjectBackupRun
  onRestore: (input: {
    artifact: ProjectBackupArtifact
    restoreCommand?: string
    run: ProjectBackupRun
    targetService?: string
    targetVolume?: string
  }) => void
}) {
  const restorableArtifacts = artifacts.filter(
    (artifact) => artifact.type === 'volume' || artifact.type === 'database',
  )
  const [selectedArtifact, setSelectedArtifact] =
    useState<ProjectBackupArtifact | null>(null)

  if (run.status !== 'succeeded' || restorableArtifacts.length === 0) {
    return <span />
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Backup run actions"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {restorableArtifacts.map((artifact) => (
            <DropdownMenuItem
              key={artifact.id}
              onSelect={(event) => {
                event.preventDefault()
                setSelectedArtifact(artifact)
              }}
            >
              Restore {formatArtifactLabel(artifact)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {selectedArtifact ? (
        <RestoreArtifactDialog
          artifact={selectedArtifact}
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
          onRestore={(input) => {
            onRestore(input)
            setSelectedArtifact(null)
          }}
        />
      ) : null}
    </>
  )
}

function RestoreArtifactDialog({
  artifact,
  composeServices,
  composeVolumes,
  isRestoring,
  open,
  run,
  onOpenChange,
  onRestore,
}: {
  artifact: ProjectBackupArtifact
  composeServices: Array<string>
  composeVolumes: Array<string>
  isRestoring: boolean
  open: boolean
  run: ProjectBackupRun
  onOpenChange: (open: boolean) => void
  onRestore: (input: {
    artifact: ProjectBackupArtifact
    restoreCommand?: string
    run: ProjectBackupRun
    targetService?: string
    targetVolume?: string
  }) => void
}) {
  const artifactName = inferArtifactName(artifact)
  const [targetVolume, setTargetVolume] = useState(
    artifact.type === 'volume'
      ? (composeVolumes.find((volume) => volume === artifactName) ??
          composeVolumes.at(0) ??
          artifactName)
      : '',
  )
  const [targetService, setTargetService] = useState(
    artifact.type === 'database'
      ? (composeServices.find((service) => service === artifactName) ??
          composeServices.at(0) ??
          artifactName)
      : '',
  )
  const [restoreCommand, setRestoreCommand] = useState(
    artifact.type === 'database'
      ? getDefaultRestoreCommand(targetService || artifactName)
      : '',
  )
  const canRestore =
    artifact.type === 'volume'
      ? targetVolume.trim() !== ''
      : targetService.trim() !== '' && restoreCommand.trim() !== ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore {formatArtifactLabel(artifact)}</DialogTitle>
          <DialogDescription>
            This queues a restore job against {run.environmentName}. Volume
            restores stop the runtime while files are replaced.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Source artifact</FieldLabel>
            <Input
              readOnly
              value={`${artifact.storage} · ${artifact.objectKey}`}
            />
          </Field>
          {artifact.type === 'volume' ? (
            <Field>
              <FieldLabel>Target volume</FieldLabel>
              <Select value={targetVolume} onValueChange={setTargetVolume}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select volume" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set([artifactName, ...composeVolumes]))
                    .filter(Boolean)
                    .map((volume) => (
                      <SelectItem key={volume} value={volume}>
                        {volume}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel>Target service</FieldLabel>
                <Select
                  value={targetService}
                  onValueChange={(value) => {
                    setTargetService(value)
                    setRestoreCommand(getDefaultRestoreCommand(value))
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select service" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(new Set([artifactName, ...composeServices]))
                      .filter(Boolean)
                      .map((service) => (
                        <SelectItem key={service} value={service}>
                          {service}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Restore command</FieldLabel>
                <Input
                  className="font-mono text-[13px]"
                  value={restoreCommand}
                  onChange={(event) => setRestoreCommand(event.target.value)}
                />
                <FieldDescription>
                  The decompressed dump is streamed to stdin.
                </FieldDescription>
              </Field>
            </>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={isRestoring}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canRestore || isRestoring}
            onClick={() =>
              onRestore({
                artifact,
                run,
                targetVolume,
                targetService,
                restoreCommand,
              })
            }
          >
            {isRestoring ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : null}
            Queue restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <DropdownMenuItem onSelect={onRun}>Run backup</DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggle}>
          {enabled ? 'Pause policy' : 'Resume policy'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <TrashIcon />
          Delete policy
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
    return <BanIcon className="size-4 shrink-0 text-muted-foreground" />
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

function formatSchedule(
  schedule: ProjectContext['backupConfigs'][number]['schedule'],
) {
  return (
    cronPresets.find((preset) => preset.value === schedule.cron)?.label ??
    schedule.cron
  )
}

function formatStatus(status: ProjectBackupRun['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatBackupArtifacts(artifacts: ProjectBackupRun['artifacts']) {
  if (artifacts.length === 0) {
    return 'No artifacts'
  }

  const local = artifacts.filter(
    (artifact) => artifact.storage === 'local',
  ).length
  const remote = artifacts.filter(
    (artifact) => artifact.storage === 'remote',
  ).length
  const size = artifacts.reduce(
    (total, artifact) => total + artifact.sizeBytes,
    0,
  )

  return `${local} local, ${remote} remote · ${formatBytes(size)}`
}

function formatArtifactLabel(artifact: ProjectBackupArtifact) {
  return `${artifact.type} ${inferArtifactName(artifact)}`
}

function inferArtifactName(artifact: ProjectBackupArtifact) {
  const fileName = artifact.objectKey.split('/').at(-1) ?? artifact.objectKey
  return fileName
    .replace(/^\d+-/, '')
    .replace(/\.sql\.gz$/, '')
    .replace(/\.tar\.gz$/, '')
    .replace(/\.json$/, '')
}

function getDefaultRestoreCommand(service: string) {
  const normalized = service.toLowerCase()

  if (normalized.includes('postgres')) {
    return 'psql -U "$POSTGRES_USER"'
  }
  if (normalized.includes('mysql')) {
    return 'mysql -u "$MYSQL_USER" -p"$MYSQL_PASSWORD"'
  }
  if (normalized.includes('mariadb')) {
    return 'mariadb -u "$MARIADB_USER" -p"$MARIADB_PASSWORD"'
  }

  return ''
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function getDefaultBackupPrefix(
  projectId: string,
  environmentId: string,
  backupId: string,
) {
  return `projects/${projectId}/environments/${environmentId}/backups/${backupId}`
}

function getDatabaseServiceOptions({
  databaseDumps,
  services,
}: {
  databaseDumps: ProjectBackupConfig['databaseDumps']
  services: Array<string>
}) {
  return Array.from(
    new Set(
      [...services, ...databaseDumps.map((dump) => dump.service)]
        .map((service) => service.trim())
        .filter(Boolean),
    ),
  ).sort()
}

function toBackupDraft(backup: ProjectBackupConfig): BackupPolicyDraft {
  return {
    accessKeyId: backup.destination.accessKeyId ?? '',
    name: backup.name,
    environmentId: backup.environmentId,
    enabled: backup.enabled,
    cron: backup.schedule.cron,
    bucket: backup.destination.bucket,
    clearSecretAccessKey: false,
    region: backup.destination.region ?? '',
    endpoint: backup.destination.endpoint ?? '',
    prefix: backup.destination.prefix ?? '',
    localRetentionCount: String(backup.retention.local.count),
    localRetentionDays: String(backup.retention.local.days),
    localRetentionMaxStorageGb: String(backup.retention.local.maxStorageGb),
    remoteRetentionEnabled: backup.retention.remote.enabled,
    remoteRetentionCount: String(backup.retention.remote.count),
    remoteRetentionDays: String(backup.retention.remote.days),
    remoteRetentionMaxStorageGb: String(backup.retention.remote.maxStorageGb),
    secretAccessKey: '',
    volumeMode: backup.volumes.mode,
    volumeNames: backup.volumes.names,
    databaseDumps: backup.databaseDumps,
  }
}

function isValidRetention(retention: ProjectBackupConfig['retention']) {
  return [retention.local, retention.remote].every(
    (item) =>
      Number.isInteger(item.count) &&
      item.count >= 0 &&
      Number.isInteger(item.days) &&
      item.days >= 0 &&
      Number.isFinite(item.maxStorageGb) &&
      item.maxStorageGb >= 0,
  )
}

function isCronSchedule(value: string) {
  return /^(\S+\s+){4}\S+$/.test(value.trim())
}

function isUrl(value: string) {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}
