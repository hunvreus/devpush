import {
  CheckIcon,
  ChevronsUpDownIcon,
  LoaderIcon,
  LockIcon,
  MoreHorizontalIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
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
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { EnvironmentDot } from './environment-dot'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-message'
import { setProjectContextQueryData } from '@/lib/project-context-query'
import { saveProjectBackupConfigs } from '@/server/projects/functions'
import type {
  ProjectBackupConfig,
  ProjectContext,
} from '@/server/projects/service'
import {
  backupCronPresets as cronPresets,
  getDefaultBackupPrefix,
  getSchedulePresetValue,
  isCronSchedule,
} from './project-backup-utils'

export type BackupPolicyDraft = {
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
  | 'bucket'
  | 'endpoint'
  | 'accessKeyId'
  | 'secretAccessKey'
  | 'retention'
  | 'volumes'
  | 'databases'
  | 'danger'

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

export function VolumeMultiSelect({
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

export function DatabaseDumpPresetMenu({
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

export function BackupPolicyDialog({
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

export function RetentionFieldGroup({
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
