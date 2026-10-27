import { mutationErrorOptions, afterMutation  } from '#devpush/lib/action-feedback'
import { toast } from 'sonner'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRightIcon, LoaderIcon, Trash2Icon } from 'lucide-react'
import { SettingsSection } from '#devpush/components/settings-layout'
import { Button } from '#devpush/components/ui/button'
import { Badge } from '#devpush/components/ui/badge'
import { ResourceAvatar } from '#devpush/components/resource-avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#devpush/components/ui/tooltip'
import { FieldError } from '#devpush/components/ui/field'
import { Skeleton } from '#devpush/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#devpush/components/ui/table'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#devpush/components/ui/alert-dialog'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { CopyButton } from '#devpush/components/copy-button'
import { apiKeyPresets, apiKeyPresetSchema } from '#devpush/lib/api-key-schema'
import {
  getMcpConnectionsAction,
  revokeMcpConnectionAction,
} from '#devpush/server/mcp/functions'

type Connection = Awaited<
  ReturnType<typeof getMcpConnectionsAction>
>['connections'][number]
export function ConnectedAppsSettings({ userId }: { userId: string }) {
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const queryKey = ['account-connected-apps', userId, page]
  const query = useQuery({
    queryKey,
    queryFn: () => getMcpConnectionsAction({ data: { page } }),
    staleTime: 30_000,
  })
  const [selected, setSelected] = useState<Connection | null>(null)
  const [busy, setBusy] = useState(false)
  async function revoke() {
    if (!selected || busy) return
    setBusy(true)

    try {
      await revokeMcpConnectionAction({ data: { id: selected.id } })
      setSelected(null)
      await afterMutation(
        () =>
          client.invalidateQueries({
            queryKey: ['account-connected-apps', userId],
          }),
        'Connection revoked, but refreshing the list failed. Please reload.',
      )
    } catch (cause) {
      toast.error(
        getPublicErrorMessage(
          cause,
          'Unable to revoke this connection. Please try again.',
        ),
        ...mutationErrorOptions(cause),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SettingsSection
        id="connected-apps"
        title="Connected apps"
        description={<ConnectedAppsDescription mcpUrl={query.data?.mcpUrl} />}
      >
        {query.isError ? (
          <div className="space-y-2">
            <FieldError>
              {getPublicErrorMessage(
                query.error,
                'Unable to load connected apps.',
              )}
            </FieldError>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : query.data ? (
          query.data.connections.length ? (
            <div className="overflow-hidden rounded-lg border">
              <Table aria-label="Connected apps" className="min-w-[640px]">
                <ConnectedAppsTableHeader />
                <TableBody>
                  {query.data.connections.map((connection) => (
                    <TableRow key={connection.id}>
                      <TableCell className="pl-4">
                        <ConnectionStatus status={connection.status} />
                      </TableCell>
                      <TableCell>
                        <p
                          className="min-w-40 max-w-64 truncate font-medium"
                          title={connection.name}
                        >
                          {connection.name}
                        </p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <ConnectionScope connection={connection} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <p>{connectionAccessLabel(connection.scopes)}</p>
                        {connection.scopes.includes('logs:read') ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Includes logs
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={connection.expiresAt}>
                          {formatDate(connection.expiresAt)}
                        </time>
                      </TableCell>
                      <TableCell className="text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive hover:text-destructive"
                                aria-label={`Revoke ${connection.name}`}
                                disabled={connection.status === 'revoked'}
                                onClick={() => {
                                  setSelected(connection)
                                }}
                              >
                                <Trash2Icon />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Revoke access</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>No connected apps.</EmptyTitle>
                <EmptyDescription>
                  Apps you authorize will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <ConnectedAppsPending />
        )}
        {query.data && query.data.pagination.totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Page {query.data.pagination.page} of{' '}
              {query.data.pagination.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  page >= query.data.pagination.totalPages || query.isFetching
                }
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </SettingsSection>
      <AlertDialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!busy && !open) {
            setSelected(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {selected?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This app will lose access immediately. You can connect it again
              through browser authorization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void revoke()
              }}
            >
              {busy ? <LoaderIcon className="animate-spin" /> : null}Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function ConnectedAppsDescription({ mcpUrl }: { mcpUrl?: string }) {
  const copyClassName =
    'inline-flex h-auto max-w-full cursor-pointer rounded-none border-0 p-0 align-baseline text-sm font-normal text-inherit whitespace-normal hover:bg-transparent hover:text-inherit dark:hover:bg-transparent [&_svg]:size-3 [&_svg]:opacity-50 [&_svg]:transition-opacity [&_svg]:duration-150 [&_svg]:ease-out motion-reduce:[&_svg]:transition-none hover:[&_svg]:opacity-100 focus-visible:[&_svg]:opacity-100'
  return (
    <div>
      Connect apps with browser sign-in or an API key using this MCP URL;{' '}
      {mcpUrl ? (
        <CopyButton
          value={mcpUrl}
          label="Copy MCP URL"
          className={copyClassName}
        >
          <code className="min-w-0 break-all font-sans">{mcpUrl}</code>
        </CopyButton>
      ) : (
        <span role="status" aria-label="MCP URL loading">
          <CopyButton
            value=""
            label="Copy MCP URL"
            disabled
            className={copyClassName}
          >
            <Skeleton className="h-4 w-56 max-w-full" />
          </CopyButton>
        </span>
      )}
    </div>
  )
}

const connectionStatuses = {
  active: { label: 'Active', variant: 'secondary', className: undefined },
  expired: {
    label: 'Expired',
    variant: 'secondary',
    className: 'text-muted-foreground',
  },
  revoked: { label: 'Revoked', variant: 'destructive', className: undefined },
  unavailable: {
    label: 'Unavailable',
    variant: 'outline',
    className: 'text-muted-foreground',
  },
} as const

function ConnectionStatus({ status }: { status: Connection['status'] }) {
  const presentation = connectionStatuses[status]
  return (
    <Badge variant={presentation.variant} className={presentation.className}>
      {presentation.label}
    </Badge>
  )
}

function ConnectionScope({ connection }: { connection: Connection }) {
  const { team, projects } = connection
  const projectNames = projects?.map(
    (project) => project.name ?? 'Unavailable project',
  )
  const projectLabel =
    projects?.length === 1
      ? projectNames![0]
      : `${projects?.length ?? 0} projects`
  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={team.name}
            tabIndex={0}
            className="shrink-0 rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span aria-hidden="true">
              <ResourceAvatar
                name={team.name}
                src={team.image ?? undefined}
                color={team.color}
                size="xs"
              />
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{team.name}</TooltipContent>
      </Tooltip>
      <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0" />
      {projects === null ? (
        <span>All projects</span>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={projectNames?.join(', ')}
              className="flex min-w-0 items-center gap-1.5 rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span aria-hidden="true" className="flex shrink-0 -space-x-1">
                {projects.slice(0, 3).map((project) => (
                  <ResourceAvatar
                    key={project.id}
                    name={project.name ?? 'Unavailable project'}
                    src={project.image ?? undefined}
                    color={project.color}
                    size="xs"
                  />
                ))}
              </span>
              <span className="max-w-40 truncate">{projectLabel}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{projectNames?.join(', ')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function ConnectedAppsTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col" className="pl-4">
          Status
        </TableHead>
        <TableHead scope="col">App</TableHead>
        <TableHead scope="col">Scope</TableHead>
        <TableHead scope="col">Access</TableHead>
        <TableHead scope="col">Expires</TableHead>
        <TableHead scope="col" className="text-right">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  )
}

export function ConnectedAppsPending() {
  return (
    <div
      role="status"
      aria-label="Connected apps loading"
      className="overflow-hidden rounded-lg border"
    >
      <Table aria-label="Connected apps" className="min-w-[640px]">
        <ConnectedAppsTableHeader />
        <TableBody>
          <TableRow>
            <TableCell className="pl-4">
              <Skeleton className="h-5 w-16 rounded-full" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-40" />
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-5 rounded" />
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground"
                />
                <Skeleton className="size-5 rounded" />
                <Skeleton className="h-4 w-24" />
              </div>
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-24" />
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Revoke access"
                disabled
              >
                <Trash2Icon />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

function connectionAccessLabel(scopes: string[]) {
  const permissions = scopes.filter((scope) => scope !== 'logs:read')
  const preset = apiKeyPresetSchema.options.find((name) =>
    permissions.every((scope) =>
      apiKeyPresets[name].scopes.some((permission) => permission === scope),
    ),
  )
  return preset ? apiKeyPresets[preset].label : 'Custom permissions'
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
