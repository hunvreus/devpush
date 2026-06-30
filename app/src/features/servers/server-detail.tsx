import { Link, useRouter } from '@tanstack/react-router'
import {
  BanIcon,
  LoaderIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ResourceAvatar } from '@/components/resource-avatar'
import { ServerAvatar } from '@/features/servers/server-avatar'
import { getErrorMessage } from '@/lib/error-message'
import {
  formatAge,
  formatServerStatus,
  formatUptime,
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
import type { ServerMetricsSample } from '@/server/servers/monitoring'
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
  const hasChanges = name.trim() !== savedName
  const hasConnectionDetails =
    server.publicAddress !== null ||
    server.agentVersion !== null ||
    server.lastSeenAt !== null ||
    server.monitoring.heartbeatCount24h > 0

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
    <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
      <div className="space-y-8">
        <section>
          <h1 className="flex items-center gap-x-3 text-2xl font-medium">
            <Link to="/$teamSlug" params={{ teamSlug: team.slug }}>
              <ResourceAvatar name={team.name} color={team.color} size="md" />
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

        <ServerInstallCallout server={server} teamSlug={team.slug} />

        <Card id="general" className="scroll-mt-8">
          <CardHeader className="border-b">
            <CardTitle>General</CardTitle>
            <CardDescription>Basic details for this server.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="space-y-3">
              <Label>Status</Label>
              <div className="flex items-center gap-x-2 text-sm">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <ServerAvatar
                        name={savedName}
                        status={server.status}
                        size="sm"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {formatServerStatus(server.status)}
                  </TooltipContent>
                </Tooltip>
                <span>{formatServerStatus(server.status)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="server-name">Name</Label>
              <Input
                id="server-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="server-id">Server ID</Label>
              <Input
                id="server-id"
                className="font-mono text-[13px] text-muted-foreground"
                value={server.id}
                readOnly
              />
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-x-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={reset}
              disabled={!hasChanges || isSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              type="button"
              onClick={() => void save()}
              disabled={!hasChanges || isSaving || name.trim().length === 0}
            >
              {isSaving ? <LoaderIcon className="animate-spin" /> : null}
              Save
            </Button>
          </CardFooter>
        </Card>

        <Card id="connection" className="scroll-mt-8">
          <CardHeader className="border-b">
            <CardTitle>Connection</CardTitle>
            <CardDescription>
              Agent connection details reported by this server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasConnectionDetails ? (
              <dl className="grid gap-4 text-sm md:grid-cols-2">
                <ServerDetailField label="Public address">
                  {server.publicAddress ?? 'Not reported'}
                </ServerDetailField>
                <ServerDetailField label="Agent version">
                  {server.agentVersion ?? 'Not reported'}
                </ServerDetailField>
                <ServerDetailField label="Last seen">
                  {server.lastSeenAt
                    ? `Last seen ${formatAge(server.lastSeenAt)}`
                    : 'Never'}
                </ServerDetailField>
                <ServerDetailField label="Uptime">
                  {server.monitoring.uptime24h !== null
                    ? `${formatUptime(server.monitoring.uptime24h)} over 24h`
                    : 'Not enough data'}
                </ServerDetailField>
                <ServerDetailField label="Heartbeats">
                  {`${server.monitoring.heartbeatCount24h.toLocaleString()} over 24h`}
                </ServerDetailField>
                <ServerDetailField label="Created">
                  {formatDate(server.createdAt)}
                </ServerDetailField>
              </dl>
            ) : (
              <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                No connection reported yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card id="metrics" className="scroll-mt-8">
          <CardHeader className="border-b">
            <CardTitle>Metrics</CardTitle>
            <CardDescription>
              Latest host metrics and 24-hour history reported by this server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {server.monitoring.latestMetrics ? (
              <>
                <dl className="grid gap-4 text-sm md:grid-cols-2">
                  <ServerDetailField label="CPU">
                    {formatPercent(server.monitoring.latestMetrics.cpuPercent)}
                  </ServerDetailField>
                  <ServerDetailField label="Load">
                    {formatNumber(server.monitoring.latestMetrics.load1)}
                  </ServerDetailField>
                  <ServerDetailField label="Memory">
                    {formatByteRatio(
                      server.monitoring.latestMetrics.memoryUsedBytes,
                      server.monitoring.latestMetrics.memoryTotalBytes,
                    )}
                  </ServerDetailField>
                  <ServerDetailField label="Disk">
                    {formatByteRatio(
                      server.monitoring.latestMetrics.diskUsedBytes,
                      server.monitoring.latestMetrics.diskTotalBytes,
                    )}
                  </ServerDetailField>
                  <ServerDetailField label="Reported">
                    {formatAge(server.monitoring.latestMetrics.observedAt)}
                  </ServerDetailField>
                </dl>

                <div className="grid gap-5 border-t pt-6 md:grid-cols-2">
                  <MetricSparkline
                    label="CPU"
                    points={server.metricSeries}
                    getValue={(sample) => sample.cpuPercent}
                    formatValue={formatPercent}
                  />
                  <MetricSparkline
                    label="Load"
                    points={server.metricSeries}
                    getValue={(sample) => sample.load1}
                    formatValue={formatNumber}
                  />
                  <MetricSparkline
                    label="Memory"
                    points={server.metricSeries}
                    getValue={(sample) =>
                      formatBytePercent(
                        sample.memoryUsedBytes,
                        sample.memoryTotalBytes,
                      )
                    }
                    formatValue={formatPercent}
                  />
                  <MetricSparkline
                    label="Disk"
                    points={server.metricSeries}
                    getValue={(sample) =>
                      formatBytePercent(
                        sample.diskUsedBytes,
                        sample.diskTotalBytes,
                      )
                    }
                    formatValue={formatPercent}
                  />
                </div>
              </>
            ) : (
              <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                No metrics reported yet.
              </p>
            )}
          </CardContent>
        </Card>

        <ServerDangerSection server={server} teamSlug={team.slug} />
      </div>

      <aside className="hidden pt-16 text-sm lg:block">
        <nav className="sticky top-[122px] flex flex-col gap-y-1">
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#general">General</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#connection">Connection</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#metrics">Metrics</a>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <a href="#danger">Danger</a>
          </Button>
        </nav>
      </aside>
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

  useEffect(() => {
    let cancelled = false

    async function createCommand() {
      if (server.status === 'disabled') {
        return
      }

      setIsCreating(true)
      setError(null)

      try {
        const result: ServerInstallCommand = await createInstallCommand({
          data: {
            teamSlug,
            serverId: server.id,
          },
        })

        if (!cancelled) {
          setInstallCommand(result.installCommand)
        }
      } catch (error) {
        if (!cancelled) {
          setError(getErrorMessage(error, 'Unable to create install command.'))
        }
      } finally {
        if (!cancelled) {
          setIsCreating(false)
        }
      }
    }

    void createCommand()

    return () => {
      cancelled = true
    }
  }, [server.id, server.status, teamSlug])

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
        ) : isCreating && !installCommand ? (
          <p className="text-sm text-muted-foreground">
            Creating install command...
          </p>
        ) : installCommand ? (
          <InstallCommand className="mt-2 max-w-xl" command={installCommand} />
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
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
                <LoaderIcon className="animate-spin" />
              ) : !isDisabled ? (
                <BanIcon />
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
                  ? `${server.name} will return to pending and can be enrolled with a fresh install command.`
                  : `This blocks new enrollment commands and agent token use for ${server.name}. Type "${server.name}" to confirm.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {!isDisabled ? (
              <div className="space-y-3">
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
              </div>
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
                <LoaderIcon className="animate-spin" />
              ) : (
                <Trash2Icon />
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

              <div className="space-y-3">
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
              </div>
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

function MetricSparkline({
  formatValue,
  getValue,
  label,
  points,
}: {
  formatValue: (value: number | null) => string
  getValue: (sample: ServerMetricsSample) => number | null
  label: string
  points: Array<ServerMetricsSample>
}) {
  const values = points
    .map((sample) => ({
      observedAt: sample.observedAt,
      value: getValue(sample),
    }))
    .filter((point): point is { observedAt: string; value: number } => {
      return point.value !== null && Number.isFinite(point.value)
    })

  const latest = values.at(-1)?.value ?? null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{formatValue(latest)}</span>
      </div>
      {values.length > 1 ? (
        <Sparkline values={values.map((point) => point.value)} />
      ) : (
        <div className="flex h-12 items-center text-sm text-muted-foreground">
          Not enough data
        </div>
      )}
    </div>
  )
}

function Sparkline({ values }: { values: Array<number> }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 120
      const y = 36 - ((value - min) / range) * 32
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg
      aria-hidden="true"
      className="h-12 w-full overflow-visible text-foreground"
      preserveAspectRatio="none"
      viewBox="0 0 120 40"
    >
      <polyline
        className="fill-none stroke-current"
        points={points}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
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

function formatNumber(value: number | null) {
  if (value === null) {
    return 'Not reported'
  }

  return value.toFixed(2)
}

function formatByteRatio(used: number | null, total: number | null) {
  if (used === null || total === null || total <= 0) {
    return 'Not reported'
  }

  return `${formatBytes(used)} / ${formatBytes(total)}`
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
