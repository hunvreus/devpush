import { mutationErrorOptions, afterMutation  } from '#devpush/lib/action-feedback'
import { getDefaultBackupPrefix } from '#devpush/lib/backup-paths'
import { isValidCron } from '#devpush/lib/backup-cron'
import { showSettingsConflict } from '#devpush/lib/settings-conflict'
import type { FormErrors } from '#devpush/lib/form-errors'
import { backupConfigSchema } from '#devpush/lib/backup-policy-schema'
import { LoaderIcon, LockIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Button } from '#devpush/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#devpush/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#devpush/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#devpush/components/ui/select'
import { Switch } from '#devpush/components/ui/switch'
import { EnvironmentDot } from './environment-dot'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { setProjectContextQueryData } from '#devpush/lib/project-context-query'
import { saveProjectBackupPolicyAction } from '#devpush/server/projects/functions'
import type {
  ProjectBackupConfig,
  ProjectContext,
} from '#devpush/server/projects/types'
import {
  backupCronPresets as cronPresets,
  getSchedulePresetValue,
} from './project-backup-utils'

export type BackupPolicyDraft = {
  cron: string
  databaseDumps: ProjectBackupConfig['databaseDumps']
  enabled: boolean
  environmentId: string
  localRetentionCount: string
  localRetentionDays: string
  localRetentionMaxStorageGb: string
  name: string
  storageId: string
  prefix: string
  remoteRetentionEnabled: boolean
  remoteRetentionCount: string
  remoteRetentionDays: string
  remoteRetentionMaxStorageGb: string
  volumeMode: 'none' | 'allNamed' | 'selected'
  volumeNames: Array<string>
}

export type BackupPolicyErrorSection =
  | 'general'
  | 'destination'
  | 'retention'
  | 'volumes'
  | 'databases'
  | 'danger'

export type BackupPolicyErrorField =
  | 'name'
  | 'environment'
  | 'schedule'
  | 'storageId'
  | 'retention'
  | 'volumes'
  | 'databases'
  | 'danger'

export function ComposeRequiredEmpty() {
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

export function BackupPolicyDialog({
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

  function changeOpen(next: boolean) {
    if (isSaving) return
    setOpen(next)
    if (!next) return
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
  }

  async function save() {
    if (isSaving) return
    const trimmedName = name.trim()
    const trimmedCron = cron.trim()

    const parsedName = backupConfigSchema.shape.name.safeParse(trimmedName)
    if (!parsedName.success) {
      setFieldError({
        field: 'name',
        message:
          parsedName.error.issues[0]?.message ?? 'Enter a backup policy name.',
      })
      return
    }

    if (
      !context.environments.some(
        (environment) => environment.id === environmentId,
      )
    ) {
      setFieldError({ field: 'environment', message: 'Select an environment.' })
      return
    }

    if (!isValidCron(trimmedCron)) {
      setFieldError({
        field: 'schedule',
        message: 'Use a five-field cron schedule, e.g. 0 2 * * *.',
      })
      return
    }

    setIsSaving(true)

    const nextConfig: ProjectBackupConfig = {
      settingsVersion: 1,
      id,
      name: trimmedName,
      environmentId,
      enabled: true,
      schedule: { cron: trimmedCron },
      destination: {
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

    try {
      const nextContext = await saveProjectBackupPolicyAction({
        data: {
          projectId: context.project.id,
          settingsVersion: null,
          teamSlug,
          projectName,
          policy: backupConfigSchema.parse(nextConfig),
        },
      })
      await setProjectContextQueryData(queryClient, nextContext, 'backups')
      onSaved(nextContext.backupConfigs)
      toast.success('Backup policy created.')
      setOpen(false)
      await afterMutation(
        () =>
          router.navigate({
            to: '/$teamSlug/projects/$projectName/backups/$backupId',
            params: { teamSlug, projectName, backupId: nextConfig.id },
          }),
        'The action completed, but opening the next page failed. Please reload.',
      )
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(error, 'Unable to save backup policy.'),
        ...mutationErrorOptions(error),
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild disabled={isSaving}>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create backup policy</DialogTitle>
          <DialogDescription>
            Configure when the agent should run a backup policy for one
            environment.
          </DialogDescription>
        </DialogHeader>

        <form
          id="backup-policy-create-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <fieldset disabled={isSaving}>
            <FieldGroup>
              <Field
                data-invalid={fieldError?.field === 'name' ? true : undefined}
              >
                <FieldLabel htmlFor={`backup-name-${id}`}>Name</FieldLabel>
                <Input
                  aria-invalid={fieldError?.field === 'name'}
                  aria-describedby={
                    fieldError?.field === 'name'
                      ? `backup-name-error-${id}`
                      : undefined
                  }
                  id={`backup-name-${id}`}
                  required
                  maxLength={100}
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
                  <FieldError id={`backup-name-error-${id}`}>
                    {fieldError.message}
                  </FieldError>
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
                    aria-label="Backup environment"
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
                      aria-label="Backup schedule"
                      required
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
          </fieldset>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={isSaving}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="backup-policy-create-form"
            disabled={isSaving}
          >
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

export function RetentionFieldGroup({
  count,
  errors = {},
  errorPrefix = 'retention',
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
  errors?: FormErrors
  errorPrefix?: string
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
            aria-invalid={fieldError || Boolean(errors[`${errorPrefix}.count`])}
            aria-label={`${title} count`}
            data-validation-field={`${errorPrefix}.count`}
            aria-describedby={
              errors[`${errorPrefix}.count`]
                ? `${errorPrefix}.count-error`
                : undefined
            }
            max={10000}
            disabled={!enabled}
            type="number"
            min={0}
            step={1}
            value={count}
            onChange={(event) => onCountChange(event.target.value)}
          />
          <FieldError id={`${errorPrefix}.count-error`}>
            {errors[`${errorPrefix}.count`]}
          </FieldError>
        </Field>
        <Field data-invalid={fieldError ? true : undefined}>
          <FieldLabel>Days to keep backups</FieldLabel>
          <Input
            aria-invalid={fieldError || Boolean(errors[`${errorPrefix}.days`])}
            aria-label={`${title} days`}
            data-validation-field={`${errorPrefix}.days`}
            aria-describedby={
              errors[`${errorPrefix}.days`]
                ? `${errorPrefix}.days-error`
                : undefined
            }
            max={3650}
            disabled={!enabled}
            type="number"
            min={0}
            step={1}
            value={days}
            onChange={(event) => onDaysChange(event.target.value)}
          />
          <FieldError id={`${errorPrefix}.days-error`}>
            {errors[`${errorPrefix}.days`]}
          </FieldError>
        </Field>
        <Field data-invalid={fieldError ? true : undefined}>
          <FieldLabel>Maximum storage (GB)</FieldLabel>
          <Input
            aria-invalid={
              fieldError || Boolean(errors[`${errorPrefix}.maxStorageGb`])
            }
            aria-label={`${title} maxStorageGb`}
            data-validation-field={`${errorPrefix}.maxStorageGb`}
            aria-describedby={
              errors[`${errorPrefix}.maxStorageGb`]
                ? `${errorPrefix}.maxStorageGb-error`
                : undefined
            }
            max={100000}
            disabled={!enabled}
            type="number"
            min={0}
            step="0.1"
            value={maxStorageGb}
            onChange={(event) => onMaxStorageGbChange(event.target.value)}
          />
          <FieldError id={`${errorPrefix}.maxStorageGb-error`}>
            {errors[`${errorPrefix}.maxStorageGb`]}
          </FieldError>
        </Field>
      </FieldGroup>
    </FieldSet>
  )
}

export function BackupPolicySection({
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

export function BackupPolicySaveActions({
  canManage = true,
  hasChanges,
  form,
  isSaving,
  onCancel,
  onSave,
}: {
  canManage?: boolean
  form?: string
  hasChanges: boolean
  isSaving: boolean
  onCancel: () => void
  onSave: () => Promise<void>
}) {
  if (!canManage) return null
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
        type={form ? 'submit' : 'button'}
        form={form}
        disabled={!hasChanges || isSaving}
        onClick={form ? undefined : () => void onSave()}
      >
        {isSaving ? (
          <LoaderIcon data-icon="inline-start" className="animate-spin" />
        ) : null}
        Save
      </Button>
    </>
  )
}
