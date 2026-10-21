import { isValidCron } from '@/lib/backup-cron'
import { showSettingsConflict } from '@/lib/settings-conflict'
import { BackupTargetList } from './backup-target-list'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { canManageTeamSettings } from '@/lib/team-role'
import { BackupPolicyDeleteDialog } from './backup-policy-delete-dialog'
import { backupConfigSchema } from '@/lib/backup-policy-schema'
import { formErrors } from '@/lib/form-errors'
import type { FormErrors } from '@/lib/form-errors'
import { afterMutation } from '@/lib/action-feedback'
import { Link, useParams, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  LockIcon,
  SettingsIcon,
  TrashIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from '@/components/ui/input-group'
import { SettingsLayout } from '@/components/settings-layout'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import { ProjectHeading } from './project-heading'
import { getPublicErrorMessage } from '@/lib/public-error'
import { setProjectContextQueryData } from '@/lib/project-context-query'
import {
  saveProjectBackupPolicyAction,
  deleteProjectBackupPolicyAction,
} from '@/server/projects/functions'
import type {
  ProjectBackupConfig,
  ProjectContext,
} from '@/server/projects/types'

import {
  backupCronPresets as cronPresets,
  backupDetailSections,
  getDatabaseServiceOptions,
  getSchedulePresetValue,
} from './project-backup-utils'
import {
  BackupPolicySaveActions,
  BackupPolicySection,
  ComposeRequiredEmpty,
  RetentionFieldGroup,
} from './project-backup-policy'
import type {
  BackupPolicyDraft,
  BackupPolicyErrorField,
  BackupPolicyErrorSection,
} from './project-backup-policy'

export function ProjectBackupDetails({
  backupId,
  context,
}: {
  backupId: string
  context: ProjectContext
}) {
  const canManage = canManageTeamSettings(context.team.role)
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
  const [storageId, setStorageId] = useState(
    backup?.destination.storageId ?? '',
  )
  const [prefix, setPrefix] = useState(backup?.destination.prefix ?? '')
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deleteSettingsVersion = useRef(backup?.settingsVersion)
  const [isSaving, setIsSaving] = useState(false)
  const [schemaErrors, setSchemaErrors] = useState<FormErrors>({})
  const previousBackup = useRef(backup)
  const draftRevision = useRef(backup?.settingsVersion)
  const refreshSavedDraft = useRef(false)
  useEffect(() => {
    if (fieldError)
      document
        .getElementById(fieldError.section)
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus()
  }, [fieldError])
  const isCustomSchedule = schedulePresetValue === 'custom'
  const missingComposeFile = context.project.runtimeConfig.path === null
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
    const previous = previousBackup.current
    previousBackup.current = backup
    if (
      !refreshSavedDraft.current &&
      previous?.id === backup.id &&
      JSON.stringify(getBackupDraft()) !==
        JSON.stringify(toBackupDraft(previous))
    )
      return
    refreshSavedDraft.current = false
    draftRevision.current = backup.settingsVersion
    setName(backup.name)
    setEnvironmentId(backup.environmentId)
    setEnabled(backup.enabled)
    setCron(backup.schedule.cron)
    setSchedulePresetValue(getSchedulePresetValue(backup.schedule.cron))
    setStorageId(backup.destination.storageId ?? '')
    setPrefix(backup.destination.prefix ?? '')
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

  if (!backup) {
    return (
      <Empty className="min-h-60 border bg-card text-card-foreground">
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
      storageId,
      prefix,
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
    setSchemaErrors({})

    setName(currentBackup.name)
    setEnvironmentId(currentBackup.environmentId)
    setEnabled(currentBackup.enabled)
    setCron(currentBackup.schedule.cron)
    setSchedulePresetValue(getSchedulePresetValue(currentBackup.schedule.cron))
    setStorageId(currentBackup.destination.storageId ?? '')
    setPrefix(currentBackup.destination.prefix ?? '')
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
    if (!canManage || isSaving || !hasChanges) return

    setSchemaErrors({})
    setFieldError(null)
    const trimmedName = name.trim()
    const trimmedCron = cron.trim()
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
      engine: dump.engine,
      database: dump.database.trim(),
    }))

    if (!trimmedName) {
      setFieldError({
        field: 'name',
        message: 'Backup policy name is required.',
        section: 'general',
      })
      return
    }

    if (
      !context.environments.some(
        (environment) => environment.id === environmentId,
      )
    ) {
      setFieldError({
        field: 'environment',
        message: 'Select an environment.',
        section: 'general',
      })
      return
    }

    if (!isValidCron(trimmedCron)) {
      setFieldError({
        field: 'schedule',
        message: 'Use a five-field cron schedule, e.g. 0 2 * * *.',
        section: 'general',
      })
      return
    }

    if (
      remoteRetentionEnabled &&
      !context.backupStorage?.some((item) => item.id === storageId)
    ) {
      setFieldError({
        field: 'storageId',
        message: 'Select a workspace backup storage destination.',
        section: 'destination',
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

    const nextConfigs = backupConfigs.map((item) =>
      item.id === backupIdValue
        ? {
            ...item,
            name: trimmedName,
            environmentId,
            enabled,
            schedule: { cron: trimmedCron },
            destination: {
              storageId: storageId || undefined,
              prefix: prefix.trim() || undefined,
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

    const candidate = nextConfigs.find((item) => item.id === backupIdValue)
    const parsed = backupConfigSchema.safeParse(candidate)
    if (!parsed.success) {
      const errors = formErrors(parsed.error.issues)
      if (errors.form) toast.error(errors.form)
      setSchemaErrors(errors)
      const firstField = Object.keys(errors)[0]
      document
        .querySelector<HTMLElement>(`[data-validation-field="${firstField}"]`)
        ?.focus()
      return
    }
    setIsSaving(true)

    try {
      const nextContext = await saveProjectBackupPolicyAction({
        data: {
          projectId: context.project.id,
          settingsVersion: draftRevision.current!,
          teamSlug,
          projectName,
          policy: parsed.data,
        },
      })
      await setProjectContextQueryData(queryClient, nextContext, 'backups')
      refreshSavedDraft.current = true
      setBackupConfigs(nextContext.backupConfigs)
      toast.success('Backup policy saved.')
      setFieldError(null)
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          'Unable to save backup policy. Please try again.',
        ),
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function deletePolicy() {
    if (isSaving) return
    setIsSaving(true)

    try {
      const nextContext = await deleteProjectBackupPolicyAction({
        data: {
          projectId: context.project.id,
          settingsVersion: deleteSettingsVersion.current!,
          teamSlug,
          projectName,
          policyId: backupIdValue,
        },
      })
      await setProjectContextQueryData(queryClient, nextContext, 'backups')
      setBackupConfigs(nextContext.backupConfigs)
      toast.success('Backup policy deleted.')
      await afterMutation(
        () =>
          router.navigate({
            to: '/$teamSlug/projects/$projectName/backups',
            params: { teamSlug, projectName },
          }),
        'The action completed, but opening the next page failed. Please reload.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const latestCompletedRun = context.backupRuns.find(
    (run) =>
      run.configId === backup.id && !['queued', 'running'].includes(run.status),
  )

  return (
    <div className="space-y-8">
      <ProjectHeading
        teamSlug={teamSlug}
        project={context.project}
        crumbs={[
          <Link
            to="/$teamSlug/projects/$projectName/backups"
            params={{ teamSlug, projectName }}
            className="truncate hover:underline"
          >
            Backups
          </Link>,
          <span className="truncate">{backup.name}</span>,
        ]}
      />

      {latestCompletedRun?.status === 'failed' ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>
            {latestCompletedRun.errorMessage ??
              'The latest backup failed. Check the configuration and run this policy again.'}
            {latestCompletedRun.localRecoveryAvailable
              ? ' Local backup available for restoration.'
              : ''}
          </AlertDescription>
        </Alert>
      ) : null}
      {backup.retention.remote.enabled &&
      !context.backupStorage?.some(
        (item) => item.id === backup.destination.storageId,
      ) ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>
            The storage destination is unavailable. Select another destination
            before running this policy. Backups will not silently fall back to
            local storage.
          </AlertDescription>
        </Alert>
      ) : null}

      <form
        id="backup-policy-form"
        noValidate
        onChangeCapture={() => {
          setSchemaErrors({})

          setFieldError(null)
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={isSaving || !canManage}>
          <SettingsLayout
            navigation={backupDetailSections
              .filter((section) => canManage || section.id !== 'danger')
              .map((section) => ({
                href: `#${section.id}`,
                label: section.label,
                destructive: section.id === 'danger',
              }))}
          >
            <BackupPolicySection
              id="general"
              title="General"
              description="Name, environment, and schedule for this backup policy."
              footer={
                <BackupPolicySaveActions
                  canManage={canManage}
                  hasChanges={hasChanges}
                  isSaving={isSaving}
                  onCancel={resetDraft}
                  onSave={save}
                  form="backup-policy-form"
                />
              }
            >
              <FieldGroup>
                <Field orientation="horizontal">
                  <Switch
                    id={`backup-policy-enabled-${backup.id}`}
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                  <FieldLabel htmlFor={`backup-policy-enabled-${backup.id}`}>
                    Enabled
                  </FieldLabel>
                </Field>

                <Field
                  data-invalid={fieldError?.field === 'name' ? true : undefined}
                >
                  <FieldLabel htmlFor={`backup-policy-name-${backup.id}`}>
                    Name (required)
                  </FieldLabel>
                  <Input
                    id={`backup-policy-name-${backup.id}`}
                    required
                    data-validation-field="name"
                    aria-describedby={
                      schemaErrors['name'] ? 'name-error' : undefined
                    }
                    maxLength={100}
                    aria-invalid={
                      Boolean(schemaErrors['name']) ||
                      fieldError?.field === 'name'
                    }
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <FieldError id="name-error">
                    {schemaErrors['name']}
                  </FieldError>
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
                    onValueChange={setEnvironmentId}
                  >
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
                  canManage={canManage}
                  hasChanges={hasChanges}
                  isSaving={isSaving}
                  onCancel={resetDraft}
                  onSave={save}
                  form="backup-policy-form"
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
                <Field>
                  <FieldLabel htmlFor={`backup-storage-${backup.id}`}>
                    Storage destination
                  </FieldLabel>
                  <ButtonGroup className="w-full">
                    <Select
                      value={storageId}
                      onValueChange={setStorageId}
                      disabled={
                        !remoteRetentionEnabled ||
                        !context.backupStorage?.length
                      }
                    >
                      <SelectTrigger
                        id={`backup-storage-${backup.id}`}
                        aria-invalid={fieldError?.field === 'storageId'}
                        className="min-w-0 flex-1 w-auto"
                      >
                        <SelectValue placeholder="Select workspace storage" />
                      </SelectTrigger>
                      <SelectContent>
                        {(context.backupStorage ?? []).map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} · {item.bucket}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {canManage ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            asChild
                            variant="outline"
                            size="icon"
                            aria-label="Manage backup storage"
                          >
                            <Link
                              to="/$teamSlug/settings"
                              params={{ teamSlug }}
                              hash="backup-storage"
                            >
                              <SettingsIcon />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Manage backup storage</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </ButtonGroup>
                  <FieldDescription>
                    Owners and admins manage storage connections in workspace
                    settings.
                  </FieldDescription>
                  <FieldError>
                    {fieldError?.field === 'storageId'
                      ? fieldError.message
                      : schemaErrors['destination.storageId']}
                  </FieldError>
                </Field>
              </FieldGroup>
            </BackupPolicySection>

            <BackupPolicySection
              id="retention"
              title="Retention"
              description="Limits retained local and remote backup generations by count, age, and storage."
              footer={
                <BackupPolicySaveActions
                  canManage={canManage}
                  hasChanges={hasChanges}
                  isSaving={isSaving}
                  onCancel={resetDraft}
                  onSave={save}
                  form="backup-policy-form"
                />
              }
            >
              <div className="grid gap-6">
                <RetentionFieldGroup
                  title="Local backups"
                  errorPrefix="retention.local"
                  errors={schemaErrors}
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
                  errorPrefix="retention.remote"
                  errors={schemaErrors}
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

            {(['volumes', 'databases'] as const).map((kind) => (
              <BackupPolicySection
                key={kind}
                id={kind}
                title={kind === 'volumes' ? 'Volumes' : 'Databases'}
                description={
                  kind === 'volumes'
                    ? 'Archive files from named Compose volumes. Use database backups for running databases.'
                    : 'Create engine-specific dumps from services. Leave Database blank to include all databases in that service. Credentials come from the service’s database environment variables.'
                }
                footer={
                  missingComposeFile ? undefined : (
                    <BackupPolicySaveActions
                      canManage={canManage}
                      hasChanges={hasChanges}
                      isSaving={isSaving}
                      onCancel={resetDraft}
                      onSave={save}
                      form="backup-policy-form"
                    />
                  )
                }
              >
                {missingComposeFile ? (
                  <ComposeRequiredEmpty />
                ) : (
                  <BackupTargetList
                    kind={kind}
                    volumes={{ mode: volumeMode, names: volumeNames }}
                    dumps={databaseDumps}
                    volumeOptions={volumeOptions}
                    serviceOptions={databaseServiceOptions}
                    onVolumesChange={(value) => {
                      setVolumeMode(value.mode)
                      setVolumeNames(value.names)
                    }}
                    onDumpsChange={setDatabaseDumps}
                    errors={schemaErrors}
                  />
                )}
                {fieldError?.section === kind ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </BackupPolicySection>
            ))}

            {canManage ? (
              <BackupPolicySection
                id="danger"
                title="Danger"
                description="Delete this backup policy. Existing backup runs are kept."
              >
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    deleteSettingsVersion.current =
                      currentBackup.settingsVersion
                    setDeleteOpen(true)
                  }}
                  disabled={isSaving}
                >
                  <TrashIcon data-icon="inline-start" />
                  Delete policy
                </Button>
                <BackupPolicyDeleteDialog
                  name={backup.name}
                  open={deleteOpen}
                  onOpenChange={(open) => {
                    if (open)
                      deleteSettingsVersion.current =
                        currentBackup.settingsVersion
                    setDeleteOpen(open)
                  }}
                  onDelete={deletePolicy}
                />
                {fieldError?.section === 'danger' ? (
                  <FieldError>{fieldError.message}</FieldError>
                ) : null}
              </BackupPolicySection>
            ) : null}
          </SettingsLayout>
        </fieldset>
      </form>
    </div>
  )
}

function toBackupDraft(backup: ProjectBackupConfig): BackupPolicyDraft {
  return {
    name: backup.name,
    environmentId: backup.environmentId,
    enabled: backup.enabled,
    cron: backup.schedule.cron,
    storageId: backup.destination.storageId ?? '',
    prefix: backup.destination.prefix ?? '',
    localRetentionCount: String(backup.retention.local.count),
    localRetentionDays: String(backup.retention.local.days),
    localRetentionMaxStorageGb: String(backup.retention.local.maxStorageGb),
    remoteRetentionEnabled: backup.retention.remote.enabled,
    remoteRetentionCount: String(backup.retention.remote.count),
    remoteRetentionDays: String(backup.retention.remote.days),
    remoteRetentionMaxStorageGb: String(backup.retention.remote.maxStorageGb),
    volumeMode: backup.volumes.mode,
    volumeNames: backup.volumes.names,
    databaseDumps: backup.databaseDumps,
  }
}
