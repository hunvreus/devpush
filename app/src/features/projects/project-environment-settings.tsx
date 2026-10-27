import { mutationErrorOptions } from '#devpush/lib/action-feedback'
import { useSettingsVersion } from '#devpush/lib/use-settings-version'
import { showSettingsConflict } from '#devpush/lib/settings-conflict'
import { projectEnvironmentsSchema } from '#devpush/lib/project-environments-schema'
import { projectEnvVarsSchema } from '#devpush/lib/project-env-schema'
import { formErrors } from '#devpush/lib/form-errors'
import type { FormErrors } from '#devpush/lib/form-errors'
import { Link, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightIcon,
  FileTextIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import type { ClipboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '#devpush/components/ui/button'
import { ButtonGroup } from '#devpush/components/ui/button-group'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#devpush/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '#devpush/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'
import { Field, FieldLabel, FieldError } from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#devpush/components/ui/select'
import { Textarea } from '#devpush/components/ui/textarea'
import {
  EnvironmentColorOption,
  EnvironmentDot,
  environmentColors,
  getEnvironmentColor,
} from './environment-dot'
import { ServerAvatar } from '#devpush/features/servers/server-avatar'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { setProjectContextQueryData } from '#devpush/lib/project-context-query'
import {
  saveProjectEnvironments,
  saveProjectEnvironmentServers,
  saveProjectEnvVars,
} from '#devpush/server/projects/functions'
import type {
  ProjectContext,
  ProjectEnvironmentConfig,
  ProjectEnvironmentVariable,
} from '#devpush/server/projects/types'
import {
  ProjectSettingsActionTooltip as IconActionTooltip,
  ProjectSettingsActions as SettingsActions,
} from './project-settings-section'
import { SettingsSection } from '#devpush/components/settings-layout'
import { EnvironmentOptionLabel } from './project-routing-settings'
import {
  EnvFileValidationError,
  isEnvFilePaste,
  parseEnvFile,
} from './project-settings-utils'

export function EnvironmentSettingsSection({
  context,
}: {
  context: ProjectContext
}) {
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const [items, setItems] = useState(context.environments)
  const [savedItems, setSavedItems] = useState(context.environments)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const productionId = savedItems.find((item) => item.slug === 'production')?.id
  const hasChanges = JSON.stringify(items) !== JSON.stringify(savedItems)

  const settingsVersion = useSettingsVersion({
    version: context.project.settingsVersion,
    dirty: hasChanges,
    saving: isSaving,
    refresh: () => {
      setItems(context.environments)
      setSavedItems(context.environments)
      setErrors({})
    },
  })

  function update(
    id: string,
    patch: Partial<
      Pick<ProjectEnvironmentConfig, 'branch' | 'color' | 'name' | 'slug'>
    >,
  ) {
    if (isSaving) return
    setErrors({})
    setItems((current) =>
      current.map((environment) =>
        environment.id === id ? { ...environment, ...patch } : environment,
      ),
    )
  }

  function add() {
    if (isSaving) return
    setErrors({})
    const id = crypto.randomUUID()

    setItems((current) => [
      ...current,
      {
        id,
        name: '',
        slug: '',
        branch: '',
        color: getEnvironmentColor(current.length + 1),
        position: current.length,
        status: 'active',
        effectiveServerId: context.project.defaultServerId,
        serverId: null,
      },
    ])
  }

  function remove(environment: ProjectEnvironmentConfig) {
    if (isSaving || environment.id === productionId) {
      return
    }

    setErrors({})
    setItems((current) => current.filter((item) => item.id !== environment.id))
  }

  async function save() {
    if (isSaving || !hasChanges) return
    const parsed = projectEnvironmentsSchema.safeParse({
      projectId: context.project.id,
      settingsVersion: settingsVersion.current,
      teamSlug: params.teamSlug,
      projectName: context.project.name,
      environments: items,
    })
    if (!parsed.success) {
      const nextErrors = formErrors(parsed.error.issues)
      if (nextErrors.environments) {
        nextErrors.form = nextErrors.environments
        delete nextErrors.environments
      }
      if (nextErrors.form) toast.error(nextErrors.form)
      setErrors(nextErrors)
      const firstField = Object.keys(nextErrors)[0]
      if (firstField) document.getElementById(firstField)?.focus()
      return
    }
    setErrors({})
    setIsSaving(true)

    try {
      const nextContext = await saveProjectEnvironments({
        data: {
          projectId: context.project.id,
          settingsVersion: settingsVersion.current,
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          environments: parsed.data.environments,
        },
      })
      settingsVersion.current = nextContext.project.settingsVersion
      await setProjectContextQueryData(queryClient, nextContext, 'settings')
      setItems(nextContext.environments)
      setSavedItems(nextContext.environments)
      toast.success('Environments saved.')
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          'Unable to save environments. Please try again.',
        ),
        ...mutationErrorOptions(error),
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingsSection
      id="environments"
      title="Environments"
      description="Deployments will be associated with the first environment with a matching branch pattern."
      footer={
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => {
            setItems(savedItems)
            setErrors({})
          }}
          form="project-environments-form"
          onSave={save}
        />
      }
    >
      <form
        id="project-environments-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={isSaving}>
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_2rem] gap-x-2 border-b pb-3 text-sm font-medium">
            <span>Name</span>
            <span>Identifier</span>
            <span>Branch</span>
            <span />
          </div>
          {items.map((environment, index) => (
            <div
              className="grid min-h-12 grid-cols-[repeat(3,minmax(0,1fr))_2rem] items-start gap-x-2 border-b py-2 text-sm"
              key={environment.id}
            >
              <Field className="gap-0">
                <div className="flex min-w-0 items-center">
                  <ColorSelect
                    value={environment.color}
                    onChange={(color) => update(environment.id, { color })}
                  />
                  <Input
                    id={`environments.${index}.name`}
                    required
                    maxLength={255}
                    aria-invalid={Boolean(errors[`environments.${index}.name`])}
                    aria-describedby={
                      errors[`environments.${index}.name`]
                        ? `environments.${index}.name-error`
                        : undefined
                    }
                    aria-label="Environment name"
                    className="rounded-l-none"
                    value={environment.name}
                    placeholder="Production"
                    onChange={(event) =>
                      update(environment.id, { name: event.target.value })
                    }
                  />
                </div>
                <FieldError id={`environments.${index}.name-error`}>
                  {errors[`environments.${index}.name`]}
                </FieldError>
              </Field>
              <Field className="gap-0">
                <Input
                  id={`environments.${index}.slug`}
                  required
                  maxLength={255}
                  aria-invalid={Boolean(errors[`environments.${index}.slug`])}
                  aria-describedby={
                    errors[`environments.${index}.slug`]
                      ? `environments.${index}.slug-error`
                      : undefined
                  }
                  aria-label="Environment identifier"
                  value={environment.slug}
                  placeholder="production"
                  readOnly={environment.id === productionId}
                  onChange={(event) =>
                    update(environment.id, { slug: event.target.value })
                  }
                />
                <FieldError id={`environments.${index}.slug-error`}>
                  {errors[`environments.${index}.slug`]}
                </FieldError>
              </Field>
              <Field className="gap-0">
                <Input
                  id={`environments.${index}.branch`}
                  required
                  maxLength={255}
                  aria-invalid={Boolean(errors[`environments.${index}.branch`])}
                  aria-describedby={
                    errors[`environments.${index}.branch`]
                      ? `environments.${index}.branch-error`
                      : undefined
                  }
                  aria-label="Environment branch"
                  value={environment.branch}
                  placeholder="main"
                  onChange={(event) =>
                    update(environment.id, { branch: event.target.value })
                  }
                />
                <FieldError id={`environments.${index}.branch-error`}>
                  {errors[`environments.${index}.branch`]}
                </FieldError>
              </Field>
              <div className="flex items-center justify-end">
                <IconActionTooltip label="Remove environment">
                  <Button
                    size="icon"
                    variant="destructive"
                    type="button"
                    onClick={() => remove(environment)}
                    disabled={isSaving || environment.id === productionId}
                    aria-label="Remove environment"
                  >
                    <Trash2Icon />
                  </Button>
                </IconActionTooltip>
              </div>
            </div>
          ))}
          <Button
            className="mt-3"
            type="button"
            variant="outline"
            onClick={add}
            disabled={isSaving}
          >
            <PlusIcon data-icon="inline-start" />
            Add environment
          </Button>
        </fieldset>
      </form>
    </SettingsSection>
  )
}

export function EnvironmentServersSettingsSection({
  context,
}: {
  context: ProjectContext
}) {
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const initialItems = context.environments.map((environment) => ({
    environmentId: environment.id,
    serverId: environment.serverId,
  }))
  const [defaultServerId, setDefaultServerId] = useState(
    context.project.defaultServerId,
  )
  const [savedDefaultServerId, setSavedDefaultServerId] = useState(
    context.project.defaultServerId,
  )
  const [items, setItems] = useState(initialItems)
  const [savedItems, setSavedItems] = useState(initialItems)
  const [isSaving, setIsSaving] = useState(false)
  const previousContext = useRef({
    environments: context.environments,
    defaultServerId: context.project.defaultServerId,
  })
  useEffect(() => {
    const previous = previousContext.current
    if (
      previous.environments === context.environments &&
      previous.defaultServerId === context.project.defaultServerId
    )
      return
    const nextItems = context.environments.map((environment) => ({
      environmentId: environment.id,
      serverId: environment.serverId,
    }))
    setItems((current) =>
      nextItems.map((next) => {
        const edited = current.find(
          (item) => item.environmentId === next.environmentId,
        )
        const before = previous.environments.find(
          (item) => item.id === next.environmentId,
        )
        return edited && edited.serverId !== before?.serverId ? edited : next
      }),
    )
    setDefaultServerId((current) =>
      current !== previous.defaultServerId
        ? current
        : context.project.defaultServerId,
    )
    setSavedItems(nextItems)
    setSavedDefaultServerId(context.project.defaultServerId)
    previousContext.current = {
      environments: context.environments,
      defaultServerId: context.project.defaultServerId,
    }
  }, [context.environments, context.project.defaultServerId])
  const hasChanges =
    defaultServerId !== savedDefaultServerId ||
    JSON.stringify(items) !== JSON.stringify(savedItems)

  const settingsVersion = useSettingsVersion({
    version: context.project.settingsVersion,
    dirty: hasChanges,
    saving: isSaving,
    refresh: () => {
      setItems(initialItems)
      setSavedItems(initialItems)
      setDefaultServerId(context.project.defaultServerId)
      setSavedDefaultServerId(context.project.defaultServerId)
    },
  })

  function update(environmentId: string, serverId: string | null) {
    if (isSaving) return

    setItems((current) =>
      current.map((item) =>
        item.environmentId === environmentId ? { ...item, serverId } : item,
      ),
    )
  }

  async function save() {
    if (isSaving || !hasChanges) return

    setIsSaving(true)

    try {
      const nextContext = await saveProjectEnvironmentServers({
        data: {
          projectId: context.project.id,
          settingsVersion: settingsVersion.current,
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          defaultServerId,
          environmentServers: items,
        },
      })
      settingsVersion.current = nextContext.project.settingsVersion
      await setProjectContextQueryData(queryClient, nextContext, 'settings')
      const nextItems = nextContext.environments.map((environment) => ({
        environmentId: environment.id,
        serverId: environment.serverId,
      }))
      setItems(nextItems)
      setSavedItems(nextItems)
      setDefaultServerId(nextContext.project.defaultServerId)
      setSavedDefaultServerId(nextContext.project.defaultServerId)
      toast.success('Servers saved.')
    } catch (cause) {
      if (showSettingsConflict(cause)) return
      toast.error(
        getPublicErrorMessage(
          cause,
          'Unable to save servers. Please try again.',
        ),
        ...mutationErrorOptions(cause),
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingsSection
      id="servers"
      title="Servers"
      description="Choose a default server, then override individual environments when needed."
      footer={
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => {
            setDefaultServerId(savedDefaultServerId)
            setItems(savedItems)
          }}
          onSave={save}
          form="project-servers-form"
        />
      }
    >
      <form
        id="project-servers-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={isSaving}>
          <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-b pb-3 text-sm font-medium">
            <span>Scope</span>
            <span>Server</span>
          </div>
          <div className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-2 border-b py-2 text-sm">
            <span>Default</span>
            <ServerAssignmentControl
              ariaLabel="Default server"
              context={context}
              serverId={defaultServerId}
              onChange={(value) => {
                setDefaultServerId(value)
              }}
            />
          </div>
          {context.environments.map((environment) => {
            const assignment = items.find(
              (item) => item.environmentId === environment.id,
            )

            return (
              <div
                className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-2 border-b py-2 text-sm"
                key={environment.id}
              >
                <EnvironmentOptionLabel
                  color={environment.color}
                  label={environment.name}
                />
                <ServerAssignmentControl
                  ariaLabel={`${environment.name} server override`}
                  context={context}
                  defaultServerId={defaultServerId}
                  serverId={assignment?.serverId ?? null}
                  onChange={(serverId) => update(environment.id, serverId)}
                />
              </div>
            )
          })}
        </fieldset>
      </form>
    </SettingsSection>
  )
}

function ServerAssignmentControl({
  ariaLabel,
  context,
  defaultServerId,
  serverId,
  onChange,
}: {
  ariaLabel: string
  context: ProjectContext
  defaultServerId?: string | null
  serverId: string | null
  onChange: (serverId: string | null) => void
}) {
  const effectiveServerId = serverId ?? defaultServerId ?? null
  const selectedServer = context.servers.find(
    (server) => server.id === effectiveServerId,
  )
  const defaultServer = context.servers.find(
    (server) => server.id === defaultServerId,
  )
  const inheritedLabel = defaultServer
    ? `Use default (${defaultServer.name})`
    : 'Use default (none)'

  return (
    <ButtonGroup className="min-w-0 w-full">
      <Select
        value={
          serverId ??
          (defaultServerId === undefined ? '__none__' : '__default__')
        }
        onValueChange={(value) =>
          onChange(
            value === '__none__' || value === '__default__' ? null : value,
          )
        }
      >
        <SelectTrigger aria-label={ariaLabel} className="min-w-0 flex-1 w-auto">
          <SelectValue placeholder="Select a server" />
        </SelectTrigger>
        <SelectContent>
          {defaultServerId === undefined ? (
            <SelectItem value="__none__">No default server</SelectItem>
          ) : (
            <SelectItem value="__default__">{inheritedLabel}</SelectItem>
          )}
          {context.servers.map((server) => (
            <SelectItem
              key={server.id}
              value={server.id}
              textValue={server.name}
            >
              <span className="flex items-center gap-x-2">
                <ServerAvatar name={server.name} status={server.status} />
                {server.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <IconActionTooltip label="Server details">
        <Button
          size="icon"
          variant="outline"
          className="text-muted-foreground hover:text-foreground"
          type="button"
          disabled={!selectedServer}
          aria-label="Server details"
          asChild={Boolean(selectedServer)}
        >
          {selectedServer ? (
            <Link
              to="/$teamSlug/servers/$serverId"
              params={{
                teamSlug: context.team.slug,
                serverId: selectedServer.id,
              }}
            >
              <ArrowRightIcon />
            </Link>
          ) : (
            <ArrowRightIcon />
          )}
        </Button>
      </IconActionTooltip>
    </ButtonGroup>
  )
}

export function EnvironmentVariablesSettingsSection({
  context,
}: {
  context: ProjectContext
}) {
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const [items, setItems] = useState(context.envVars)
  const [savedItems, setSavedItems] = useState(context.envVars)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const hasChanges = JSON.stringify(items) !== JSON.stringify(savedItems)

  const settingsVersion = useSettingsVersion({
    version: context.project.settingsVersion,
    dirty: hasChanges,
    saving: isSaving,
    refresh: () => {
      setItems(context.envVars)
      setSavedItems(context.envVars)
      setErrors({})
    },
  })

  function add() {
    if (isSaving) return
    setErrors({})
    setItems((current) => [...current, { key: '', value: '', environment: '' }])
  }

  function insertEnvFile(envFile: string) {
    if (isSaving) return
    setErrors({})
    const parsed = parseEnvFile(envFile)

    if (parsed.length === 0) {
      throw new EnvFileValidationError(
        'Enter at least one KEY=value assignment.',
      )
    }

    setItems((current) => [
      ...current.filter((item) => item.key || item.value),
      ...parsed.map((item) => ({ ...item, environment: '' })),
    ])
  }

  function handleEnvFilePaste(event: ClipboardEvent<HTMLElement>) {
    const pastedText = event.clipboardData.getData('text')

    if (!isEnvFilePaste(pastedText)) {
      return
    }

    event.preventDefault()
    insertEnvFile(pastedText)
  }

  function update(index: number, patch: Partial<ProjectEnvironmentVariable>) {
    if (isSaving) return
    setErrors({})
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    )
  }

  async function save() {
    if (isSaving || !hasChanges) return
    const parsed = projectEnvVarsSchema.safeParse({
      projectId: context.project.id,
      settingsVersion: settingsVersion.current,
      teamSlug: params.teamSlug,
      projectName: context.project.name,
      envVars: items,
    })
    const nextErrors: FormErrors = parsed.success
      ? {}
      : formErrors(parsed.error.issues)
    items.forEach((item, index) => {
      if (
        item.environment &&
        !context.environments.some((env) => env.id === item.environment)
      )
        nextErrors[`envVars.${index}.environment`] =
          'Select a valid environment.'
    })
    if (nextErrors.form) toast.error(nextErrors.form)
    setErrors(nextErrors)
    if (!parsed.success || Object.keys(nextErrors).length) {
      const firstField = Object.keys(nextErrors)[0]
      if (firstField) document.getElementById(firstField)?.focus()
      return
    }
    setIsSaving(true)

    try {
      const nextContext = await saveProjectEnvVars({
        data: {
          projectId: context.project.id,
          settingsVersion: settingsVersion.current,
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          envVars: parsed.data.envVars,
        },
      })
      settingsVersion.current = nextContext.project.settingsVersion
      await setProjectContextQueryData(queryClient, nextContext, 'settings')
      setItems(nextContext.envVars)
      setSavedItems(nextContext.envVars)
      toast.success('Environment variables saved.')
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          'Unable to save environment variables. Please try again.',
        ),
        ...mutationErrorOptions(error),
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingsSection
      id="environment-variables"
      title="Environment variables"
      description="Variables available at build time and runtime. Changes will take effect after a new deployment."
      footer={
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => {
            setItems(savedItems)
            setErrors({})
          }}
          form="project-env-form"
          onSave={save}
        />
      }
    >
      <form
        id="project-env-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={isSaving}>
          {items.length > 0 ? (
            <div>
              <div className="grid grid-cols-[200px_minmax(0,1fr)_220px_2rem] gap-x-2 border-b pb-3 text-sm font-medium">
                <span>Key</span>
                <span>Value</span>
                <span>Environment</span>
                <span />
              </div>
              {items.map((envVar, index) => (
                <div
                  className="grid min-h-12 grid-cols-[200px_minmax(0,1fr)_220px_2rem] items-start gap-x-2 border-b py-2 text-sm"
                  key={`env-var:${index}`}
                >
                  <Field className="gap-0">
                    <Input
                      id={`envVars.${index}.key`}
                      required
                      aria-invalid={Boolean(errors[`envVars.${index}.key`])}
                      aria-describedby={
                        errors[`envVars.${index}.key`]
                          ? `envVars.${index}.key-error`
                          : undefined
                      }
                      aria-label="Environment variable key"
                      value={envVar.key}
                      placeholder="e.g. MY_VAR"
                      onChange={(event) =>
                        update(index, { key: event.target.value })
                      }
                      onPaste={handleEnvFilePaste}
                    />
                    <FieldError id={`envVars.${index}.key-error`}>
                      {errors[`envVars.${index}.key`]}
                    </FieldError>
                  </Field>
                  <Field className="gap-0">
                    <EnvVarValueTextarea
                      value={envVar.value}
                      onChange={(value) => update(index, { value })}
                      onPaste={handleEnvFilePaste}
                    />
                  </Field>
                  <Field className="gap-0">
                    <Select
                      value={envVar.environment || '__all__'}
                      onValueChange={(environment) =>
                        update(index, {
                          environment:
                            environment === '__all__' ? '' : environment,
                        })
                      }
                    >
                      <SelectTrigger
                        id={`envVars.${index}.environment`}
                        aria-invalid={Boolean(
                          errors[`envVars.${index}.environment`],
                        )}
                        aria-describedby={
                          errors[`envVars.${index}.environment`]
                            ? `envVars.${index}.environment-error`
                            : undefined
                        }
                        aria-label="Environment variable environment"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">
                          All environments
                        </SelectItem>
                        {context.environments.map((environment) => (
                          <SelectItem
                            key={environment.id}
                            value={environment.id}
                          >
                            <EnvironmentOptionLabel
                              color={environment.color}
                              label={environment.name}
                            />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError id={`envVars.${index}.environment-error`}>
                      {errors[`envVars.${index}.environment`]}
                    </FieldError>
                  </Field>
                  <div className="flex items-center justify-end">
                    <IconActionTooltip label="Remove environment variable">
                      <Button
                        size="icon"
                        variant="destructive"
                        type="button"
                        onClick={() => {
                          setErrors({})
                          setItems((current) =>
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }}
                        disabled={isSaving}
                        aria-label="Remove environment variable"
                      >
                        <Trash2Icon />
                      </Button>
                    </IconActionTooltip>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>No environment variables.</EmptyTitle>
                <EmptyDescription>
                  Add variables available to builds and deployments.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <EnvironmentVariableActions
                  disabled={isSaving}
                  onAdd={add}
                  onInsert={insertEnvFile}
                />
              </EmptyContent>
            </Empty>
          )}
          {items.length > 0 ? (
            <div className="mt-3">
              <EnvironmentVariableActions
                disabled={isSaving}
                onAdd={add}
                onInsert={insertEnvFile}
              />
            </div>
          ) : null}
        </fieldset>
      </form>
    </SettingsSection>
  )
}

function EnvironmentVariableActions({
  disabled,
  onAdd,
  onInsert,
}: {
  disabled: boolean
  onAdd: () => void
  onInsert: (envFile: string) => void
}) {
  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="outline"
        onClick={onAdd}
        disabled={disabled}
      >
        <PlusIcon data-icon="inline-start" />
        Add variable
      </Button>
      <PasteEnvFileDialog disabled={disabled} onInsert={onInsert} />
    </ButtonGroup>
  )
}

function EnvVarValueTextarea({
  onChange,
  onPaste,
  value,
}: {
  onChange: (value: string) => void
  onPaste: (event: ClipboardEvent<HTMLElement>) => void
  value: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    resizeTextarea(ref.current)
  }, [value])

  return (
    <Textarea
      ref={ref}
      aria-label="Environment variable value"
      className="min-h-8 resize-none overflow-hidden break-all py-1.5 font-mono text-[13px]"
      placeholder="value"
      value={value}
      onPaste={onPaste}
      onChange={(event) => {
        onChange(event.target.value)
        resizeTextarea(event.currentTarget)
      }}
    />
  )
}

function PasteEnvFileDialog({
  disabled,
  onInsert,
}: {
  disabled: boolean
  onInsert: (envFile: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [envFile, setEnvFile] = useState('')
  const [error, setError] = useState<string | null>(null)

  function insert() {
    if (disabled) return
    try {
      onInsert(envFile)
      setEnvFile('')
      setError(null)
      setOpen(false)
    } catch (cause) {
      if (showSettingsConflict(cause)) return
      setError(
        cause instanceof EnvFileValidationError
          ? cause.message
          : 'Unable to import these variables.',
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setError(null)
      }}
    >
      <IconActionTooltip label="Paste .env">
        <DialogTrigger asChild>
          <Button
            aria-label="Paste .env"
            disabled={disabled}
            size="icon"
            type="button"
            variant="outline"
          >
            <FileTextIcon />
          </Button>
        </DialogTrigger>
      </IconActionTooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Paste .env file</DialogTitle>
          <DialogDescription>
            Paste the contents of your .env file to add variables to this
            project.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="env-file-content">.env content</FieldLabel>
          <Textarea
            id="env-file-content"
            className="max-h-36 min-h-24 overflow-y-auto break-all font-mono text-[13px]"
            value={envFile}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'env-file-error' : undefined}
            onChange={(event) => {
              setEnvFile(event.target.value)
              setError(null)
            }}
          />
          <FieldError id="env-file-error">{error}</FieldError>
        </Field>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={disabled || !envFile.trim()}
            type="button"
            onClick={insert}
          >
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return
  }

  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

function ColorSelect({
  onChange,
  value,
}: {
  onChange: (value: string) => void
  value: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Environment color"
          className="rounded-r-none border-r-0 text-foreground hover:bg-input/50 hover:text-foreground"
          size="icon"
          type="button"
          variant="outline"
        >
          <EnvironmentDot color={value} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-auto overflow-visible p-2"
      >
        <div className="grid grid-cols-6 gap-2">
          {environmentColors.map((color) => (
            <button
              aria-label={`Set environment color to ${color}`}
              className="flex size-7 items-center justify-center rounded-full border border-transparent transition-colors hover:border-foreground/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              key={color}
              onClick={() => onChange(color)}
              type="button"
            >
              <EnvironmentColorOption checked={value === color} color={color} />
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
