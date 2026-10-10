import { serverNameSchema } from '@/lib/server-name-schema'
import { afterMutation, copyText } from '@/lib/action-feedback'
import { Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  BanIcon,
  CopyIcon,
  EllipsisIcon,
  LoaderIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TeamHeading } from '@/features/teams/team-heading'
import { ServerAvatar } from '@/features/servers/server-avatar'
import { getErrorMessage, getFieldErrorMessage } from '@/lib/error-message'
import { invalidateResourceQueries } from '@/lib/resource-cache'
import { cn } from '@/lib/utils'
import { canManageTeamSettings } from '@/lib/team-role'
import {
  createInstallCommand,
  createServer,
  deleteServer,
  disableServer,
  enableServer,
  getDeleteServerDiagnostic,
} from '@/server/servers/functions'
import type {
  CreatedServer,
  ServerDeleteDiagnostic,
  ServerInstallCommand,
} from '@/server/servers/service'
import type { ServerSummary, TeamSummary } from '@/server/teams/types'

type ServerItem = ServerSummary | CreatedServer

export function TeamServers({
  serverInstall,
  team,
  servers,
}: {
  serverInstall?: {
    ready: boolean
    message: string | null
  }
  team: TeamSummary
  servers: Array<ServerSummary>
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [items, setItems] = useState<Array<ServerItem>>(servers)
  const [addServerOpen, setAddServerOpen] = useState(false)
  const canManageServers = canManageTeamSettings(team.role)
  useEffect(() => {
    setItems(servers)
  }, [servers])

  return (
    <>
      <TeamHeading
        team={team}
        crumb={<span>Servers</span>}
        actions={
          items.length > 0 && canManageServers ? (
            <Button onClick={() => setAddServerOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Add server
            </Button>
          ) : null
        }
      />

      <section className="space-y-4">
        {!serverInstall?.ready && serverInstall?.message ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {serverInstall.message}
          </div>
        ) : null}
        {items.length > 0 ? (
          <ul className="overflow-hidden rounded-xl border bg-card text-card-foreground">
            {items.map((server) => (
              <li
                className="flex h-11 min-w-0 items-center gap-4 border-b px-4 text-sm last:border-b-0 hover:bg-muted/50"
                key={server.id}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <ServerAvatar
                          size="sm"
                          name={server.name}
                          status={server.status}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {formatServerStatus(server.status)}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        className="truncate font-medium hover:underline"
                        to="/$teamSlug/servers/$serverId"
                        params={{ teamSlug: team.slug, serverId: server.id }}
                      >
                        {server.name}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>Server</TooltipContent>
                  </Tooltip>
                </span>

                {'publicAddress' in server && server.publicAddress ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate text-muted-foreground">
                        {server.publicAddress}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Public address</TooltipContent>
                  </Tooltip>
                ) : null}

                {'lastSeenAt' in server && server.lastSeenAt ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="whitespace-nowrap text-muted-foreground">
                        Last seen {formatAge(server.lastSeenAt)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Last seen</TooltipContent>
                  </Tooltip>
                ) : null}

                {'agentUpdate' in server &&
                server.agentUpdate.status !== 'current' ? (
                  <Badge
                    variant={
                      server.agentUpdate.status === 'required'
                        ? 'destructive'
                        : 'outline'
                    }
                  >
                    Agent update {server.agentUpdate.status}
                  </Badge>
                ) : null}

                {canManageServers ? (
                  <div className="ml-auto flex items-center gap-1">
                    <ServerActionsMenu
                      server={server}
                      teamSlug={team.slug}
                      onChanged={async () => {
                        await invalidateResourceQueries(queryClient, team.slug)
                        await router.invalidate()
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="min-h-60 border bg-card text-card-foreground">
            <EmptyHeader>
              <EmptyTitle>Connect your first server.</EmptyTitle>
              <EmptyDescription>
                Add a server before creating and deploying projects.
              </EmptyDescription>
            </EmptyHeader>
            {canManageServers ? (
              <EmptyContent>
                <Button onClick={() => setAddServerOpen(true)}>
                  <PlusIcon data-icon="inline-start" />
                  Add server
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </section>

      {canManageServers ? (
        <AddServerDialog
          open={addServerOpen}
          teamSlug={team.slug}
          onOpenChange={setAddServerOpen}
          onCreated={async (server) => {
            setItems((current) => [server, ...current])
            await afterMutation(async () => {
              await invalidateResourceQueries(queryClient, team.slug)
              await router.invalidate()
            }, 'Server created, but refreshing the page failed. Please reload.')
          }}
        />
      ) : null}
    </>
  )
}

export function formatAge(value: string) {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000))

  if (diffMinutes < 1) {
    return 'just now'
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`
  }

  const diffHours = Math.round(diffMinutes / 60)

  if (diffHours < 48) {
    return `${diffHours}h ago`
  }

  return `${Math.round(diffHours / 24)}d ago`
}

export function formatServerStatus(status: ServerItem['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatCount(count: number, singular: string) {
  return `${count.toLocaleString()} ${singular}${count === 1 ? '' : 's'}`
}

export function ServerActionsMenu({
  server,
  teamSlug,
  onChanged,
}: {
  server: Pick<ServerItem, 'id' | 'name' | 'status'>
  teamSlug: string
  onChanged: () => void | Promise<void>
}) {
  const [installOpen, setInstallOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [disableConfirmation, setDisableConfirmation] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [cancelOngoingDeployments, setCancelOngoingDeployments] = useState(true)
  const [deleteDiagnostic, setDeleteDiagnostic] =
    useState<ServerDeleteDiagnostic | null>(null)
  const [deleteDiagnosticError, setDeleteDiagnosticError] = useState<
    string | null
  >(null)
  const [isChangingStatus, setIsChangingStatus] = useState(false)
  const diagnosticRequest = useRef(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [serverDeleted, setServerDeleted] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLoadingDeleteDiagnostic, setIsLoadingDeleteDiagnostic] =
    useState(false)
  const isDisabled = server.status === 'disabled'
  const canChangeStatus =
    !isChangingStatus && (isDisabled || disableConfirmation === server.name)
  const canDelete =
    !isDeleting && !serverDeleted && deleteConfirmation.trim() === server.name

  async function toggleServerStatus() {
    if (
      isChangingStatus ||
      isDeleting ||
      serverDeleted ||
      (!isDisabled && disableConfirmation !== server.name)
    )
      return
    setActionError(null)
    setIsChangingStatus(true)

    try {
      if (isDisabled) {
        await enableServer({
          data: {
            teamSlug,
            serverId: server.id,
          },
        })
        toast.success('Server enabled.')
      } else {
        await disableServer({
          data: {
            teamSlug,
            serverId: server.id,
            confirmationName: disableConfirmation,
          },
        })
        toast.success('Server disabled.')
      }

      setStatusOpen(false)
      await afterMutation(
        async () => onChanged(),
        'The action completed, but refreshing the page failed. Please reload.',
      )
    } catch (error) {
      setActionError(getErrorMessage(error, 'Unable to update server status.'))
    } finally {
      setIsChangingStatus(false)
    }
  }

  async function loadDeleteDiagnostic() {
    const request = ++diagnosticRequest.current
    setIsLoadingDeleteDiagnostic(true)
    setDeleteDiagnosticError(null)

    try {
      const diagnostic = await getDeleteServerDiagnostic({
        data: {
          teamSlug,
          serverId: server.id,
        },
      })
      if (request !== diagnosticRequest.current) return
      setDeleteDiagnostic(diagnostic)
    } catch (error) {
      if (request !== diagnosticRequest.current) return
      setDeleteDiagnosticError(
        getErrorMessage(error, 'Unable to inspect server usage.'),
      )
    } finally {
      if (request === diagnosticRequest.current)
        setIsLoadingDeleteDiagnostic(false)
    }
  }

  async function deleteCurrentServer() {
    if (
      isDeleting ||
      isChangingStatus ||
      serverDeleted ||
      deleteConfirmation.trim() !== server.name
    )
      return
    setActionError(null)
    setIsDeleting(true)

    try {
      await deleteServer({
        data: {
          teamSlug,
          serverId: server.id,
          confirmationName: deleteConfirmation,
          cancelOngoingDeployments,
        },
      })
      setServerDeleted(true)
      setDeleteOpen(false)
      toast.success('Server deleted.')
      setDeleteOpen(false)
      await afterMutation(
        async () => onChanged(),
        'The action completed, but refreshing the page failed. Please reload.',
      )
    } catch (error) {
      setActionError(getErrorMessage(error, 'Unable to delete server.'))
    } finally {
      setIsDeleting(false)
    }
  }

  function onStatusOpenChange(open: boolean) {
    if (isChangingStatus || isDeleting || serverDeleted) return
    setActionError(null)
    setStatusOpen(open)

    if (!open) {
      setDisableConfirmation('')
    }
  }

  function onDeleteOpenChange(open: boolean) {
    if (isDeleting || isChangingStatus || serverDeleted) return
    diagnosticRequest.current += 1
    setActionError(null)
    setDeleteOpen(open)

    if (!open) {
      setDeleteConfirmation('')
      setDeleteDiagnostic(null)
      setDeleteDiagnosticError(null)
      setCancelOngoingDeployments(true)
      return
    }

    void loadDeleteDiagnostic()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`Actions for ${server.name}`}
            size="icon"
            type="button"
            variant="ghost"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          {server.status === 'connected' ? null : (
            <>
              <DropdownMenuItem
                className="whitespace-nowrap"
                disabled={isDisabled}
                onSelect={() => setInstallOpen(true)}
              >
                {isDisabled
                  ? 'Enable server to install agent'
                  : 'Install agent'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {isDisabled ? (
            <DropdownMenuItem
              className="whitespace-nowrap"
              onSelect={() => onStatusOpenChange(true)}
            >
              Enable server
            </DropdownMenuItem>
          ) : null}
          {!isDisabled ? (
            <DropdownMenuItem
              className="whitespace-nowrap"
              variant="destructive"
              onSelect={() => onStatusOpenChange(true)}
            >
              <BanIcon />
              Disable server
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="whitespace-nowrap"
            variant="destructive"
            onSelect={() => onDeleteOpenChange(true)}
          >
            <Trash2Icon />
            Delete server
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <InstallServerDialog
        open={installOpen}
        server={server}
        teamSlug={teamSlug}
        onOpenChange={setInstallOpen}
      />

      <AlertDialog open={statusOpen} onOpenChange={onStatusOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isDisabled ? 'Enable this server?' : 'Disable this server?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isDisabled
                ? `${server.name} will return to pending and can be enrolled with a fresh install command.`
                : `This blocks new enrollment commands and agent token use for ${server.name}. Type "${server.name}" to confirm.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {!isDisabled ? (
            <Field>
              <Input
                aria-label={`Type ${server.name} to confirm`}
                required
                disabled={isChangingStatus}
                placeholder={server.name}
                value={disableConfirmation}
                onChange={(event) => setDisableConfirmation(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canChangeStatus) {
                    event.preventDefault()
                    void toggleServerStatus()
                  }
                }}
              />
            </Field>
          ) : null}

          <FieldError role="alert">{actionError}</FieldError>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isChangingStatus}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!canChangeStatus}
              variant={isDisabled ? 'default' : 'destructive'}
              onClick={(event) => {
                event.preventDefault()
                void toggleServerStatus()
              }}
            >
              {isChangingStatus ? (
                <LoaderIcon className="animate-spin" />
              ) : !isDisabled ? (
                <BanIcon />
              ) : null}
              {isDisabled ? 'Enable server' : 'Disable server'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={onDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this server?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {server.name} from server lists and
              assignment pickers, deletes its monitoring data, and cannot be
              undone. {`Type "${server.name}" to confirm.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            {isLoadingDeleteDiagnostic ? (
              <p className="text-sm text-muted-foreground">
                Inspecting server usage...
              </p>
            ) : deleteDiagnosticError ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {deleteDiagnosticError}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void loadDeleteDiagnostic()}
                >
                  Retry inspection
                </Button>
              </div>
            ) : deleteDiagnostic ? (
              <p className="text-sm">
                {deleteDiagnostic.projectCount === 0
                  ? 'This will impact no active projects or environments.'
                  : `This will impact ${formatCount(deleteDiagnostic.projectCount, 'project')} and ${formatCount(deleteDiagnostic.environmentCount, 'environment')}.`}
              </p>
            ) : null}

            <Field orientation="horizontal">
              <Checkbox
                id="delete-server-list-cancel-deployments"
                checked={cancelOngoingDeployments}
                disabled={isDeleting || serverDeleted}
                onCheckedChange={(checked) =>
                  setCancelOngoingDeployments(checked === true)
                }
              />
              <FieldLabel htmlFor="delete-server-list-cancel-deployments">
                Cancel ongoing deployments on this server
              </FieldLabel>
            </Field>

            <Field>
              <Input
                aria-label={`Type ${server.name} to confirm`}
                required
                disabled={isDeleting || serverDeleted}
                placeholder={server.name}
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canDelete) {
                    event.preventDefault()
                    void deleteCurrentServer()
                  }
                }}
              />
            </Field>
          </div>

          <FieldError role="alert">{actionError}</FieldError>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting || serverDeleted}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!canDelete}
              variant="destructive"
              onClick={(event) => {
                event.preventDefault()
                void deleteCurrentServer()
              }}
            >
              {isDeleting ? <LoaderIcon className="animate-spin" /> : null}
              Delete server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function InstallServerDialog({
  open,
  teamSlug,
  server,
  onOpenChange,
}: {
  open?: boolean
  teamSlug: string
  server: Pick<ServerItem, 'id' | 'name'>
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [installCommand, setInstallCommand] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const isOpen = open ?? internalOpen

  async function createCommand() {
    if (isCreating) {
      return
    }

    setInstallError(null)
    setIsCreating(true)

    try {
      const result: ServerInstallCommand = await createInstallCommand({
        data: {
          teamSlug,
          serverId: server.id,
        },
      })
      setInstallCommand(result.installCommand)
    } catch (error) {
      setInstallError(
        getErrorMessage(error, 'Unable to create install command.'),
      )
    } finally {
      setIsCreating(false)
    }
  }

  function close(nextOpen: boolean) {
    if (isCreating) return
    onOpenChange?.(nextOpen)

    if (open === undefined) {
      setInternalOpen(nextOpen)
    }

    if (!nextOpen) {
      setInstallCommand(null)
      setInstallError(null)
    }
  }

  useEffect(() => {
    if (!isOpen || installCommand || isCreating || installError) {
      return
    }

    void createCommand()
  }, [isOpen, installCommand, isCreating, installError])

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install {server.name}</DialogTitle>
          <DialogDescription>
            {getInstallDescription(server.name)}
          </DialogDescription>
        </DialogHeader>

        {isCreating && !installCommand ? (
          <div className="text-sm text-muted-foreground">
            Creating install command...
          </div>
        ) : installCommand ? (
          <InstallCommand command={installCommand} />
        ) : installError ? (
          <div className="space-y-3">
            <FieldError role="alert">{installError}</FieldError>
            <Button
              type="button"
              variant="outline"
              onClick={() => void createCommand()}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function AddServerDialog({
  open,
  teamSlug,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  teamSlug: string
  onOpenChange: (open: boolean) => void
  onCreated: (server: CreatedServer) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [createdServer, setCreatedServer] = useState<CreatedServer | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isCreating) return
    const parsed = serverNameSchema.safeParse(name)
    if (!parsed.success) {
      setNameError(
        parsed.error.issues[0]?.message ?? 'Enter a valid server name.',
      )
      return
    }
    setNameError(null)
    setIsCreating(true)

    try {
      const server = await createServer({
        data: {
          teamSlug,
          name,
        },
      })

      setCreatedServer(server)
      await onCreated(server)
    } catch (error) {
      setNameError(
        getFieldErrorMessage({
          error,
          field: 'name',
          fallback: 'Unable to add server.',
        }),
      )
    } finally {
      setIsCreating(false)
    }
  }

  function close(nextOpen: boolean) {
    if (isCreating) return
    onOpenChange(nextOpen)

    if (!nextOpen) {
      setName('')
      setNameError(null)
      setCreatedServer(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {createdServer ? 'Install server agent' : 'Add server'}
          </DialogTitle>
          <DialogDescription>
            {createdServer
              ? getInstallDescription(createdServer.name)
              : 'Create a server enrollment token and run the installer on the host.'}
          </DialogDescription>
        </DialogHeader>

        {createdServer ? (
          <div className="space-y-4">
            <InstallCommand command={createdServer.installCommand} />
            <div className="flex justify-end">
              <Button type="button" onClick={() => close(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => void submit(event)}
          >
            <Field data-invalid={Boolean(nameError)}>
              <FieldLabel htmlFor="server-name">Name (required)</FieldLabel>
              <Input
                aria-invalid={Boolean(nameError)}
                id="server-name"
                disabled={isCreating}
                maxLength={100}
                aria-describedby="new-server-name-error"
                onChange={(event) => {
                  setName(event.target.value)
                  setNameError(null)
                }}
                placeholder="e.g., hetzner-fsn1"
                required
                value={name}
              />
              <FieldError id="new-server-name-error">{nameError}</FieldError>
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                type="button"
                onClick={() => close(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button disabled={!name || isCreating} type="submit">
                {isCreating ? (
                  <LoaderIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : null}
                Create server
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function InstallCommand({
  command,
  className,
  inputClassName,
}: {
  command: string
  className?: string
  inputClassName?: string
}) {
  async function copyInstallCommand() {
    await copyText(command, 'Install command')
  }

  return (
    <InputGroup className={cn('h-8', className)}>
      <InputGroupInput
        aria-label="Install command"
        className={cn('h-8 font-mono text-xs text-foreground', inputClassName)}
        readOnly
        value={command}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          aria-label="Copy install command"
          onClick={() => void copyInstallCommand()}
          size="icon-xs"
        >
          <CopyIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function getInstallDescription(serverName: string) {
  return `Run this command on ${serverName} to provision Docker and install or reconnect the agent. The host must run a supported systemd-based Linux distribution and be able to reach this devpush instance. The enrollment token expires after 1 hour.`
}
