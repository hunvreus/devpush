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

import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Dialog,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  EnvironmentColorOption,
  EnvironmentDot,
  environmentColors,
  getEnvironmentColor,
} from './environment-dot'
import { ServerAvatar } from '@/features/servers/server-avatar'
import { getErrorMessage } from '@/lib/error-message'
import { setProjectContextQueryData } from '@/lib/project-context-query'
import {
  saveProjectEnvironments,
  saveProjectEnvironmentServers,
  saveProjectEnvVars,
} from '@/server/projects/functions'
import type {
  ProjectContext,
  ProjectEnvironmentConfig,
  ProjectEnvironmentVariable,
} from '@/server/projects/service'
import {
  ProjectSettingsActionTooltip as IconActionTooltip,
  ProjectSettingsActions as SettingsActions,
  ProjectSettingsSection as SettingsSection,
} from './project-settings-section'
import { EnvironmentOptionLabel } from './project-routing-settings'
import { isEnvFilePaste, parseEnvFile } from './project-settings-utils'

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
  const hasChanges = JSON.stringify(items) !== JSON.stringify(savedItems)

  function update(
    id: string,
    patch: Partial<
      Pick<ProjectEnvironmentConfig, 'branch' | 'color' | 'name' | 'slug'>
    >,
  ) {
    setItems((current) =>
      current.map((environment) =>
        environment.id === id ? { ...environment, ...patch } : environment,
      ),
    )
  }

  function add() {
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
    if (environment.slug === 'production') {
      return
    }

    setItems((current) => current.filter((item) => item.id !== environment.id))
  }

  async function save() {
    setIsSaving(true)

    try {
      const nextContext = await saveProjectEnvironments({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          environments: items,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      setItems(nextContext.environments)
      setSavedItems(nextContext.environments)
      toast.success('Environments saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save environments.'))
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
          onCancel={() => setItems(savedItems)}
          onSave={save}
        />
      }
    >
      <div>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_2rem] gap-x-2 border-b pb-3 text-sm font-medium">
          <span>Name</span>
          <span>Identifier</span>
          <span>Branch</span>
          <span />
        </div>
        {items.map((environment) => (
          <div
            className="grid min-h-12 grid-cols-[repeat(3,minmax(0,1fr))_2rem] items-center gap-x-2 border-b py-2 text-sm"
            key={environment.id}
          >
            <Field className="gap-0">
              <div className="flex min-w-0 items-center">
                <ColorSelect
                  value={environment.color}
                  onChange={(color) => update(environment.id, { color })}
                />
                <Input
                  aria-label="Environment name"
                  className="rounded-l-none"
                  value={environment.name}
                  placeholder="Production"
                  onChange={(event) =>
                    update(environment.id, { name: event.target.value })
                  }
                />
              </div>
            </Field>
            <Field className="gap-0">
              <Input
                aria-label="Environment identifier"
                value={environment.slug}
                placeholder="production"
                readOnly={environment.slug === 'production'}
                onChange={(event) =>
                  update(environment.id, { slug: event.target.value })
                }
              />
            </Field>
            <Field className="gap-0">
              <Input
                aria-label="Environment branch"
                value={environment.branch}
                placeholder="main"
                onChange={(event) =>
                  update(environment.id, { branch: event.target.value })
                }
              />
            </Field>
            <div className="flex items-center justify-end">
              <IconActionTooltip label="Remove environment">
                <Button
                  size="icon"
                  variant="destructive"
                  type="button"
                  onClick={() => remove(environment)}
                  disabled={isSaving || environment.slug === 'production'}
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
      </div>
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
  const hasChanges =
    defaultServerId !== savedDefaultServerId ||
    JSON.stringify(items) !== JSON.stringify(savedItems)

  function update(environmentId: string, serverId: string | null) {
    setItems((current) =>
      current.map((item) =>
        item.environmentId === environmentId ? { ...item, serverId } : item,
      ),
    )
  }

  async function save() {
    setIsSaving(true)

    try {
      const nextContext = await saveProjectEnvironmentServers({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          defaultServerId,
          environmentServers: items,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      const nextItems = nextContext.environments.map((environment) => ({
        environmentId: environment.id,
        serverId: environment.serverId,
      }))
      setItems(nextItems)
      setSavedItems(nextItems)
      setDefaultServerId(nextContext.project.defaultServerId)
      setSavedDefaultServerId(nextContext.project.defaultServerId)
      toast.success('Servers saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save servers.'))
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
        />
      }
    >
      <div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-b pb-3 text-sm font-medium">
          <span>Scope</span>
          <span>Server</span>
        </div>
        <div className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 border-b py-2 text-sm">
          <span>Default</span>
          <ServerAssignmentControl
            ariaLabel="Default server"
            context={context}
            serverId={defaultServerId}
            onChange={setDefaultServerId}
          />
        </div>
        {context.environments.map((environment) => {
          const assignment = items.find(
            (item) => item.environmentId === environment.id,
          )

          return (
            <div
              className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 border-b py-2 text-sm"
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
      </div>
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
  const hasChanges = JSON.stringify(items) !== JSON.stringify(savedItems)

  function add() {
    setItems((current) => [...current, { key: '', value: '', environment: '' }])
  }

  function insertEnvFile(envFile: string) {
    const parsed = parseEnvFile(envFile)

    if (parsed.length === 0) {
      return
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
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    )
  }

  async function save() {
    setIsSaving(true)

    try {
      const nextContext = await saveProjectEnvVars({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          envVars: items,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      setItems(nextContext.envVars)
      setSavedItems(nextContext.envVars)
      toast.success('Environment variables saved.')
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Unable to save environment variables.'),
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
          onCancel={() => setItems(savedItems)}
          onSave={save}
        />
      }
    >
      <div>
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
                    aria-label="Environment variable key"
                    value={envVar.key}
                    placeholder="e.g. MY_VAR"
                    onChange={(event) =>
                      update(index, { key: event.target.value })
                    }
                    onPaste={handleEnvFilePaste}
                  />
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
                      aria-label="Environment variable environment"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All environments</SelectItem>
                      {context.environments.map((environment) => (
                        <SelectItem key={environment.id} value={environment.id}>
                          <EnvironmentOptionLabel
                            color={environment.color}
                            label={environment.name}
                          />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex items-center justify-end">
                  <IconActionTooltip label="Remove environment variable">
                    <Button
                      size="icon"
                      variant="destructive"
                      type="button"
                      onClick={() =>
                        setItems((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
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
      </div>
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

  function insert() {
    onInsert(envFile)
    setEnvFile('')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            onChange={(event) => setEnvFile(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!envFile.trim()} type="button" onClick={insert}>
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
