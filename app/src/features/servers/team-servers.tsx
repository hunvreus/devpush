import { Link, useRouter } from '@tanstack/react-router'
import {
  BanIcon,
  CopyIcon,
  EllipsisIcon,
  LoaderIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
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
import { ResourceAvatar } from '@/components/resource-avatar'
import { ServerAvatar } from '@/features/servers/server-avatar'
import { getErrorMessage, getFieldErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
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
import type { ServerSummary, TeamSummary } from '@/server/teams/service'

type ServerItem = ServerSummary | CreatedServer

export function TeamServers({
  serverInstall,
  team,
  servers,
}: {
  serverInstall: {
    ready: boolean
    message: string | null
  }
  team: TeamSummary
  servers: Array<ServerSummary>
}) {
  const router = useRouter()
  const [items, setItems] = useState<Array<ServerItem>>(servers)
  const [addServerOpen, setAddServerOpen] = useState(false)
  useEffect(() => {
    setItems(servers)
  }, [servers])

  return (
    <>
      <section className="flex items-center justify-between gap-4">
        <h1 className="flex items-center gap-x-3 text-2xl font-medium">
          <Link to="/$teamSlug" params={{ teamSlug: team.slug }}>
            <ResourceAvatar name={team.name} color={team.color} size="md" />
          </Link>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <span>Servers</span>
        </h1>
        {items.length > 0 ? (
          <Button onClick={() => setAddServerOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Add server
          </Button>
        ) : null}
      </section>

      <section className="space-y-4">
        {!serverInstall.ready && serverInstall.message ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {serverInstall.message}
          </div>
        ) : null}
        {items.length > 0 ? (
          <ul>
            {items.map((server) => (
              <li
                className="flex h-12 min-w-0 items-center gap-4 border border-b-0 px-4 text-sm first:rounded-t-xl last:rounded-b-xl last:border-b hover:bg-muted/50"
                key={server.id}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <ServerAvatar
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

                <div className="ml-auto flex items-center gap-1">
                  <ServerActionsMenu
                    server={server}
                    teamSlug={team.slug}
                    onChanged={() => void router.invalidate()}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="min-h-60 border bg-card text-card-foreground shadow-sm">
            <EmptyHeader>
              <EmptyTitle>Connect your first server.</EmptyTitle>
              <EmptyDescription>
                Add a server before creating and deploying projects.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setAddServerOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                Add server
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </section>

      <AddServerDialog
        open={addServerOpen}
        teamSlug={team.slug}
        onOpenChange={setAddServerOpen}
        onCreated={(server) => setItems((current) => [server, ...current])}
      />
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

function ServerActionsMenu({
  server,
  teamSlug,
  onChanged,
}: {
  server: ServerItem
  teamSlug: string
  onChanged: () => void
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
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLoadingDeleteDiagnostic, setIsLoadingDeleteDiagnostic] =
    useState(false)
  const isDisabled = server.status === 'disabled'
  const canChangeStatus =
    !isChangingStatus && (isDisabled || disableConfirmation === server.name)
  const canDelete = !isDeleting && deleteConfirmation.trim() === server.name

  async function toggleServerStatus() {
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
      onChanged()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to update server status.'))
    } finally {
      setIsChangingStatus(false)
    }
  }

  async function loadDeleteDiagnostic() {
    setIsLoadingDeleteDiagnostic(true)
    setDeleteDiagnosticError(null)

    try {
      const diagnostic = await getDeleteServerDiagnostic({
        data: {
          teamSlug,
          serverId: server.id,
        },
      })
      setDeleteDiagnostic(diagnostic)
    } catch (error) {
      setDeleteDiagnosticError(
        getErrorMessage(error, 'Unable to inspect server usage.'),
      )
    } finally {
      setIsLoadingDeleteDiagnostic(false)
    }
  }

  async function deleteCurrentServer() {
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
      toast.success('Server deleted.')
      setDeleteOpen(false)
      onChanged()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete server.'))
    } finally {
      setIsDeleting(false)
    }
  }

  function onStatusOpenChange(open: boolean) {
    setStatusOpen(open)

    if (!open) {
      setDisableConfirmation('')
    }
  }

  function onDeleteOpenChange(open: boolean) {
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
                onSelect={() => setInstallOpen(true)}
              >
                Install agent
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {isDisabled ? (
            <DropdownMenuItem
              className="whitespace-nowrap"
              onSelect={() => setStatusOpen(true)}
            >
              Enable server
            </DropdownMenuItem>
          ) : null}
          {!isDisabled ? (
            <DropdownMenuItem
              className="whitespace-nowrap"
              variant="destructive"
              onSelect={() => setStatusOpen(true)}
            >
              <BanIcon />
              Disable server
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="whitespace-nowrap"
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
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
              <p className="text-sm text-destructive">
                {deleteDiagnosticError}
              </p>
            ) : deleteDiagnostic ? (
              <p className="text-sm">
                {deleteDiagnostic.projectCount === 0
                  ? 'This will impact no active projects or environments.'
                  : `This will impact ${formatCount(deleteDiagnostic.projectCount, 'project')} and ${formatCount(deleteDiagnostic.environmentCount, 'environment')}.`}
              </p>
            ) : null}

            <label className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={cancelOngoingDeployments}
                disabled={isDeleting}
                onCheckedChange={(checked) =>
                  setCancelOngoingDeployments(checked === true)
                }
              />
              <span className="font-medium">
                Cancel ongoing deployments on this server
              </span>
            </label>

            <Field>
              <Input
                aria-label={`Type ${server.name} to confirm`}
                disabled={isDeleting}
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

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
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

function InstallServerDialog({
  open,
  teamSlug,
  server,
  onOpenChange,
}: {
  open?: boolean
  teamSlug: string
  server: ServerItem
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [installCommand, setInstallCommand] = useState<string | null>(null)
  const isOpen = open ?? internalOpen

  async function createCommand() {
    if (isCreating) {
      return
    }

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
      toast.error(getErrorMessage(error, 'Unable to create install command.'))
    } finally {
      setIsCreating(false)
    }
  }

  function close(nextOpen: boolean) {
    onOpenChange?.(nextOpen)

    if (open === undefined) {
      setInternalOpen(nextOpen)
    }

    if (!nextOpen) {
      setInstallCommand(null)
    }
  }

  useEffect(() => {
    if (!isOpen || installCommand || isCreating) {
      return
    }

    void createCommand()
  }, [isOpen, installCommand, isCreating])

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
  onCreated: (server: CreatedServer) => void
}) {
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [createdServer, setCreatedServer] = useState<CreatedServer | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
      onCreated(server)
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
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            <Field data-invalid={Boolean(nameError)}>
              <FieldLabel htmlFor="server-name">Name</FieldLabel>
              <Input
                aria-invalid={Boolean(nameError)}
                id="server-name"
                onChange={(event) => {
                  setName(event.target.value)
                  setNameError(null)
                }}
                placeholder="e.g., hetzner-fsn1"
                required
                value={name}
              />
              <FieldError>{nameError}</FieldError>
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                type="button"
                onClick={() => close(false)}
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
    await navigator.clipboard.writeText(command)
    toast.success('Install command copied.')
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
  return `Run this command on ${serverName} to install or reconnect the agent. The host must have Docker installed and be able to reach this devpush instance. The enrollment token expires after 1 hour.`
}
