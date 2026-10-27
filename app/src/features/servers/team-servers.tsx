import {
  requestWorkspaceAction,
  useWorkspaceServerSetup,
} from '#devpush/features/plugins/contributions'
import { CopyButton } from '#devpush/components/copy-button'
import { serverNameSchema } from '#devpush/lib/server-name-schema'
import { afterMutation } from '#devpush/lib/action-feedback'
import { Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { SettingsIcon, LoaderIcon, PlusIcon } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

import { Button } from '#devpush/components/ui/button'
import { Badge } from '#devpush/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#devpush/components/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'
import { Field, FieldError, FieldLabel } from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#devpush/components/ui/tooltip'
import { TeamHeading } from '#devpush/features/teams/team-heading'
import { ServerAvatar } from '#devpush/features/servers/server-avatar'
import { getFieldErrorMessage } from '#devpush/lib/error-message'
import { invalidateResourceQueries } from '#devpush/lib/resource-cache'
import { cn } from '#devpush/lib/utils'
import { canManageTeamSettings } from '#devpush/lib/team-role'
import { createServer } from '#devpush/server/servers/functions'
import type { CreatedServer } from '#devpush/server/servers/service'
import type { ServerSummary, TeamSummary } from '#devpush/server/teams/types'

type ServerItem = ServerSummary | CreatedServer

export function TeamServers({
  serverInstall,
  team,
  servers,
  initialAddServerOpen = false,
}: {
  initialAddServerOpen?: boolean
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
  const [addServerOpen, setAddServerOpen] = useState(initialAddServerOpen)
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
          <ul className="scrollbar overflow-x-auto rounded-xl border bg-card text-card-foreground">
            {items.map((server) => (
              <li
                className="flex h-11 min-w-[20rem] items-center gap-4 border-b px-4 text-sm whitespace-nowrap last:border-b-0 hover:bg-muted/50"
                key={server.id}
              >
                <span className="flex min-w-0 max-w-64 items-center gap-2">
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
                      <span className="hidden max-w-48 truncate text-muted-foreground sm:inline">
                        {server.publicAddress}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Public address</TooltipContent>
                  </Tooltip>
                ) : null}

                {'lastSeenAt' in server && server.lastSeenAt ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="hidden shrink-0 whitespace-nowrap text-muted-foreground md:inline">
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
                  <div className="ml-auto shrink-0">
                    <div className="-mr-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild variant="outline" size="icon-sm">
                            <Link
                              to="/$teamSlug/servers/$serverId"
                              params={{
                                teamSlug: team.slug,
                                serverId: server.id,
                              }}
                              aria-label={`Settings for ${server.name}`}
                            >
                              <SettingsIcon />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Settings</TooltipContent>
                      </Tooltip>
                    </div>
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
  const setup = useWorkspaceServerSetup({ teamSlug })
  const [isCreating, setIsCreating] = useState(false)
  const [createdServer, setCreatedServer] = useState<CreatedServer | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isCreating || !setup.ready) return
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
      if (requestWorkspaceAction({ teamSlug, error })) onOpenChange(false)
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

        {setup.fields}
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
              <FieldLabel htmlFor="server-name">Name</FieldLabel>
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
              <Button
                disabled={!name || isCreating || !setup.ready}
                type="submit"
              >
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
  return (
    <InputGroup className={cn('h-8', className)}>
      <InputGroupInput
        aria-label="Install command"
        className={cn('h-8 font-mono text-xs text-foreground', inputClassName)}
        readOnly
        value={command}
      />
      <InputGroupAddon align="inline-end">
        <CopyButton
          value={command}
          label="Copy install command"
          size="icon-xs"
          inputGroup
        />
      </InputGroupAddon>
    </InputGroup>
  )
}

export function getInstallDescription(serverName: string) {
  return `Run this command on ${serverName} to provision Docker and install or reconnect the agent. The host must run a supported systemd-based Linux distribution and be able to reach this devpush instance. The enrollment token expires after 1 hour.`
}
