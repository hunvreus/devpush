import { Link, useRouter } from '@tanstack/react-router'
import {
  BanIcon,
  CopyIcon,
  LoaderIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
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
import { SectionNavigation } from '@/components/section-navigation'
import { ServerAvatar } from '@/features/servers/server-avatar'
import { ServerMetricChart } from '@/features/servers/server-metric-chart'
import { getErrorMessage } from '@/lib/error-message'
import { canManageTeamSettings } from '@/lib/team-role'
import {
  formatAge,
  formatServerStatus,
  getInstallDescription,
  InstallCommand,
} from '@/features/servers/team-servers'
import {
  createInstallCommand,
  deleteServer,
  disableServer,
  enableServer,
  getDeleteServerDiagnostic,
  updateServer,
} from '@/server/servers/functions'

import type {
  ServerDeleteDiagnostic,
  ServerDetail as ServerDetailData,
  ServerInstallCommand,
} from '@/server/servers/service'
import type { TeamSummary } from '@/server/teams/service'

export function ServerDetail({
  server,
  team,
}: {
  server: ServerDetailData
  team: TeamSummary
}) {
  const router = useRouter()
  const [savedName, setSavedName] = useState(server.name)
  const [name, setName] = useState(server.name)
  const [isSaving, setIsSaving] = useState(false)
  const canManageServer = canManageTeamSettings(team.role)
  const hasChanges = name.trim() !== savedName

  async function save() {
    setIsSaving(true)

    try {
      await updateServer({
        data: {
          teamSlug: team.slug,
          serverId: server.id,
          name,
        },
      })
      const nextName = name.trim()
      setName(nextName)
      setSavedName(nextName)
      toast.success('Server saved.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save server.'))
    } finally {
      setIsSaving(false)
    }
  }

  function reset() {
    setName(savedName)
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="flex items-center gap-x-3 text-2xl font-medium">
          <Link to="/$teamSlug" params={{ teamSlug: team.slug }}>
            <ResourceAvatar
              name={team.name}
              src={team.image ?? undefined}
              color={team.color}
              size="md"
            />
          </Link>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <Link
            className="hover:underline"
            to="/$teamSlug/servers"
            params={{ teamSlug: team.slug }}
          >
            Servers
          </Link>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <span className="truncate">{savedName}</span>
        </h1>
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <div className="space-y-8">
          {server.status === 'connected' || !canManageServer ? null : (
            <ServerInstallCallout server={server} teamSlug={team.slug} />
          )}

          {server.agentUpdate.status === 'current' ? null : (
            <Alert
              variant={
                server.agentUpdate.status === 'required'
                  ? 'destructive'
                  : 'default'
              }
            >
              <AlertTitle className="flex items-center gap-2">
                Agent update {server.agentUpdate.status}
                {server.agentUpdate.latestVersion ? (
                  <Badge variant="outline">
                    {server.agentUpdate.latestVersion}
                  </Badge>
                ) : null}
              </AlertTitle>
              <AlertDescription>
                {server.agentUpdate.reason} Update manually with{' '}
                <code>sudo /usr/local/lib/devpush/update-agent</code>.
              </AlertDescription>
            </Alert>
          )}

          <Card id="general" className="scroll-mt-8">
            <CardHeader className="border-b">
              <CardTitle>General</CardTitle>
              <CardDescription>Basic details for this server.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm font-medium">Status</p>
                <div className="flex items-center gap-2 text-sm">
                  <ServerAvatar
                    name={savedName}
                    status={server.status}
                    size="sm"
                  />
                  <span>{formatServerStatus(server.status)}</span>
                  <span className="text-muted-foreground">
                    ·{' '}
                    {server.lastSeenAt
                      ? formatAge(server.lastSeenAt)
                      : 'Never contacted'}
                  </span>
                </div>
              </div>

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="server-name">Name</FieldLabel>
                  <Input
                    id="server-name"
                    value={name}
                    readOnly={!canManageServer}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="server-id">Server ID</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="server-id"
                      className="font-mono text-[13px] text-muted-foreground"
                      value={server.id}
                      readOnly
                    />
                    <InputGroupAddon align="inline-end">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <InputGroupButton
                            size="icon-sm"
                            type="button"
                            aria-label="Copy server ID"
                            onClick={() =>
                              void navigator.clipboard.writeText(server.id)
                            }
                          >
                            <CopyIcon />
                          </InputGroupButton>
                        </TooltipTrigger>
                        <TooltipContent>Copy server ID</TooltipContent>
                      </Tooltip>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    A unique identifier used by the API and agent.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            {canManageServer ? (
              <CardFooter className="justify-end gap-x-2">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={reset}
                  disabled={!hasChanges || isSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void save()}
                  disabled={!hasChanges || isSaving || name.trim().length === 0}
                >
                  {isSaving ? (
                    <LoaderIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : null}
                  Save
                </Button>
              </CardFooter>
            ) : null}
          </Card>

          <Card id="host" className="scroll-mt-8">
            <CardHeader className="border-b">
              <CardTitle>Host</CardTitle>
              <CardDescription>
                System information reported by the agent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 gap-y-5 text-sm md:grid-cols-2">
                <ServerDetailField label="Hostname">
                  {server.hostname ?? 'Not reported'}
                </ServerDetailField>
                <ServerDetailField label="Operating system">
                  {server.operatingSystem ?? 'Not reported'}
                </ServerDetailField>
                <ServerDetailField label="CPU">
                  {server.cpuCoreCount
                    ? formatCount(server.cpuCoreCount, 'core')
                    : 'Not reported'}
                </ServerDetailField>
                <ServerDetailField label="Memory">
                  {server.monitoring.latestMetrics?.memoryTotalBytes
                    ? formatBytes(
                        server.monitoring.latestMetrics.memoryTotalBytes,
                      )
                    : 'Not reported'}
                </ServerDetailField>
                <ServerDetailField label="Architecture">
                  {server.architecture ?? 'Not reported'}
                </ServerDetailField>
                <ServerDetailField label="Host uptime">
                  {server.status === 'connected' &&
                  server.hostUptimeSeconds !== null
                    ? formatDuration(server.hostUptimeSeconds)
                    : 'Not reported'}
                </ServerDetailField>
                <ServerDetailField label="Kernel">
                  {server.kernelVersion ?? 'Not reported'}
                </ServerDetailField>
                <ServerDetailField label="Agent version">
                  {server.agentVersion ?? 'Not reported'}
                </ServerDetailField>
              </dl>
            </CardContent>
          </Card>

          <Card id="metrics" className="scroll-mt-8">
            <CardHeader className="border-b">
              <CardTitle>Metrics</CardTitle>
              <CardDescription>
                Up to 24 hours of host resource history. Missing samples remain
                visible as gaps.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {server.monitoring.latestMetrics ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <ServerMetricChart
                      domain={[0, 100]}
                      label="CPU usage"
                      latestValue={formatPercent(
                        server.monitoring.latestMetrics.cpuPercent,
                      )}
                      points={server.metricSeries}
                      formatValue={formatPercent}
                      series={[
                        {
                          key: 'cpu',
                          label: 'CPU',
                          color: 'var(--chart-1)',
                          getValue: (sample) => sample.cpuPercent,
                        },
                      ]}
                      window={server.metricWindow}
                    />
                    <ServerMetricChart
                      domain={[0, 100]}
                      label="Memory usage"
                      latestValue={formatByteRatio(
                        server.monitoring.latestMetrics.memoryUsedBytes,
                        server.monitoring.latestMetrics.memoryTotalBytes,
                      )}
                      points={server.metricSeries}
                      formatValue={formatPercent}
                      series={[
                        {
                          key: 'memory',
                          label: 'Memory',
                          color: 'var(--chart-1)',
                          getValue: (sample) =>
                            formatBytePercent(
                              sample.memoryUsedBytes,
                              sample.memoryTotalBytes,
                            ),
                        },
                      ]}
                      window={server.metricWindow}
                    />
                    <ServerMetricChart
                      domain={[0, 100]}
                      label="Disk usage"
                      latestValue={formatByteRatio(
                        server.monitoring.latestMetrics.diskUsedBytes,
                        server.monitoring.latestMetrics.diskTotalBytes,
                      )}
                      points={server.metricSeries}
                      formatValue={formatPercent}
                      series={[
                        {
                          key: 'disk',
                          label: 'Disk',
                          color: 'var(--chart-1)',
                          getValue: (sample) =>
                            formatBytePercent(
                              sample.diskUsedBytes,
                              sample.diskTotalBytes,
                            ),
                        },
                      ]}
                      window={server.metricWindow}
                    />
                    <ServerMetricChart
                      label="Network traffic"
                      latestValue={formatNetworkSummary(
                        server.monitoring.latestMetrics
                          .networkReceiveBytesPerSecond,
                        server.monitoring.latestMetrics
                          .networkTransmitBytesPerSecond,
                      )}
                      points={server.metricSeries}
                      formatValue={formatBytesPerSecond}
                      series={[
                        {
                          key: 'received',
                          label: 'Received',
                          color: 'var(--chart-1)',
                          getValue: (sample) =>
                            sample.networkReceiveBytesPerSecond,
                        },
                        {
                          key: 'sent',
                          label: 'Sent',
                          color: 'var(--chart-2)',
                          getValue: (sample) =>
                            sample.networkTransmitBytesPerSecond,
                        },
                      ]}
                      window={server.metricWindow}
                    />
                  </div>
                </>
              ) : (
                <Empty className="min-h-40 border">
                  <EmptyHeader>
                    <EmptyTitle>No metrics reported yet.</EmptyTitle>
                    <EmptyDescription>
                      Metrics will appear after the agent reports host data.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>

          {canManageServer ? (
            <ServerDangerSection server={server} teamSlug={team.slug} />
          ) : null}
        </div>

        <aside className="hidden lg:block">
          <SectionNavigation
            className="sticky top-[122px]"
            items={[
              { href: '#general', label: 'General' },
              { href: '#host', label: 'Host' },
              { href: '#metrics', label: 'Metrics' },
              ...(canManageServer
                ? [
                    {
                      href: '#danger' as const,
                      label: 'Danger',
                      destructive: true,
                    },
                  ]
                : []),
            ]}
          />
        </aside>
      </div>
    </div>
  )
}

function ServerInstallCallout({
  server,
  teamSlug,
}: {
  server: ServerDetailData
  teamSlug: string
}) {
  const [installCommand, setInstallCommand] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createCommand() {
    setIsCreating(true)
    setError(null)

    try {
      const result: ServerInstallCommand = await createInstallCommand({
        data: {
          teamSlug,
          serverId: server.id,
        },
      })
      setInstallCommand(result.installCommand)
    } catch (cause) {
      setError(getErrorMessage(cause, 'Unable to create install command.'))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Alert className="gap-y-2">
      <SquareTerminalIcon />
      <AlertTitle>Install agent</AlertTitle>
      <AlertDescription className="col-start-2 space-y-3 [&_p:not(:last-child)]:mb-0">
        <p>{getInstallDescription(server.name)}</p>
        {server.status === 'disabled' ? (
          <p className="text-sm text-muted-foreground">
            Enable this server before creating a new install command.
          </p>
        ) : installCommand ? (
          <InstallCommand className="mt-2 max-w-xl" command={installCommand} />
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <Button
            className="mt-2"
            disabled={isCreating}
            onClick={() => void createCommand()}
            type="button"
            variant="outline"
          >
            {isCreating ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : null}
            Generate install command
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

function ServerDangerSection({
  server,
  teamSlug,
}: {
  server: ServerDetailData
  teamSlug: string
}) {
  const router = useRouter()
  const [isChangingStatus, setIsChangingStatus] = useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [disableConfirmation, setDisableConfirmation] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [cancelOngoingDeployments, setCancelOngoingDeployments] = useState(true)
  const [deleteDiagnostic, setDeleteDiagnostic] =
    useState<ServerDeleteDiagnostic | null>(null)
  const [deleteDiagnosticError, setDeleteDiagnosticError] = useState<
    string | null
  >(null)
  const [isLoadingDeleteDiagnostic, setIsLoadingDeleteDiagnostic] =
    useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const isDisabled = server.status === 'disabled'
  const canDisable =
    !isChangingStatus && (isDisabled || disableConfirmation === server.name)
  const canDelete = !isDeleting && deleteConfirmation.trim() === server.name

  async function toggleServerStatus() {
    setIsChangingStatus(true)

    try {
      if (isDisabled) {
        await enableServer({
          data: { teamSlug, serverId: server.id },
        })
      } else {
        await disableServer({
          data: {
            teamSlug,
            serverId: server.id,
            confirmationName: disableConfirmation,
          },
        })
      }
      toast.success(isDisabled ? 'Server enabled.' : 'Server disabled.')
      setStatusDialogOpen(false)
      setDisableConfirmation('')
      await router.invalidate()
    } catch (error) {
      toast.error(
        getErrorMessage(
          error,
          isDisabled ? 'Unable to enable server.' : 'Unable to disable server.',
        ),
      )
    } finally {
      setIsChangingStatus(false)
    }
  }

  async function loadDeleteDiagnostic() {
    setIsLoadingDeleteDiagnostic(true)
    setDeleteDiagnostic(null)
    setDeleteDiagnosticError(null)

    try {
      const diagnostic = await getDeleteServerDiagnostic({
        data: { teamSlug, serverId: server.id },
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
      await router.navigate({ to: '/$teamSlug/servers', params: { teamSlug } })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete server.'))
    } finally {
      setIsDeleting(false)
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

  function onStatusOpenChange(open: boolean) {
    setStatusDialogOpen(open)

    if (!open) {
      setDisableConfirmation('')
    }
  }

  return (
    <Card id="danger" className="scroll-mt-8">
      <CardHeader className="border-b">
        <CardTitle>Danger</CardTitle>
        <CardDescription>
          Administrative actions that affect this server.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-2">
        <AlertDialog open={statusDialogOpen} onOpenChange={onStatusOpenChange}>
          <AlertDialogTrigger asChild>
            <Button
              variant={isDisabled ? 'default' : 'destructive'}
              disabled={isChangingStatus}
            >
              {isChangingStatus ? (
                <LoaderIcon data-icon="inline-start" className="animate-spin" />
              ) : !isDisabled ? (
                <BanIcon data-icon="inline-start" />
              ) : null}
              {isDisabled ? 'Enable server' : 'Disable server'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isDisabled ? 'Enable this server?' : 'Disable this server?'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isDisabled
                  ? `${server.name} will accept its existing agent credential again. Reinstallation is not required.`
                  : `This blocks new enrollment commands and agent token use for ${server.name}. Type "${server.name}" to confirm.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {!isDisabled ? (
              <Field>
                <Input
                  aria-label={`Type ${server.name} to confirm`}
                  id="disable-server-confirmation"
                  placeholder={server.name}
                  value={disableConfirmation}
                  onChange={(event) =>
                    setDisableConfirmation(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canDisable) {
                      event.preventDefault()
                      void toggleServerStatus()
                    }
                  }}
                  disabled={isChangingStatus}
                />
              </Field>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isChangingStatus}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant={isDisabled ? 'default' : 'destructive'}
                disabled={!canDisable}
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
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={isDeleting}>
              {isDeleting ? (
                <LoaderIcon data-icon="inline-start" className="animate-spin" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              Delete server
            </Button>
          </AlertDialogTrigger>
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
                  onCheckedChange={(checked) =>
                    setCancelOngoingDeployments(checked === true)
                  }
                  disabled={isDeleting}
                />
                <span className="font-medium">
                  Cancel ongoing deployments on this server
                </span>
              </label>

              <Field>
                <Input
                  aria-label={`Type ${server.name} to confirm`}
                  id="delete-server-confirmation"
                  placeholder={server.name}
                  value={deleteConfirmation}
                  onChange={(event) =>
                    setDeleteConfirmation(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canDelete) {
                      event.preventDefault()
                      void deleteCurrentServer()
                    }
                  }}
                  disabled={isDeleting}
                />
              </Field>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={!canDelete}
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
      </CardContent>
    </Card>
  )
}

function formatCount(count: number, singular: string) {
  return `${count.toLocaleString()} ${singular}${count === 1 ? '' : 's'}`
}

function ServerDetailField({
  children,
  label,
}: {
  children: string
  label: string
}) {
  return (
    <div className="space-y-1">
      <dt className="font-medium">{label}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  )
}

function formatPercent(value: number | null) {
  if (value === null) {
    return 'Not reported'
  }

  return `${value.toFixed(1)}%`
}

function formatByteRatio(used: number | null, total: number | null) {
  if (used === null || total === null || total <= 0) {
    return 'Not reported'
  }

  return `${formatBytes(used)} / ${formatBytes(total)}`
}

function formatBytesPerSecond(value: number | null) {
  return value === null ? 'Not reported' : `${formatBytes(value)}/s`
}

function formatNetworkSummary(received: number | null, sent: number | null) {
  if (received === null && sent === null) {
    return 'Not reported'
  }
  return `↓ ${formatBytesPerSecond(received)}  ↑ ${formatBytesPerSecond(sent)}`
}

function formatDuration(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function formatBytePercent(used: number | null, total: number | null) {
  if (used === null || total === null || total <= 0) {
    return null
  }

  return (used / total) * 100
}

function formatBytes(value: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let unitIndex = 0

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }

  return `${current.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}
