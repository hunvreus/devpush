import { useQueryClient } from '@tanstack/react-query'
import { invalidateResourceQueries } from '@/lib/resource-cache'
import { serverNameSchema } from '@/lib/server-name-schema'
import { afterMutation, copyText } from '@/lib/action-feedback'
import { Link, useRouter } from '@tanstack/react-router'
import {
  BanIcon,
  CopyIcon,
  LoaderIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from 'lucide-react'
import { useRef, useState } from 'react'
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
  FieldError,
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
import { SettingsLayout, SettingsSection } from '@/components/settings-layout'
import { TeamHeading } from '@/features/teams/team-heading'
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
import type { TeamSummary } from '@/server/teams/types'

export function ServerDetail({
  server,
  team,
}: {
  server: ServerDetailData
  team: TeamSummary
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [savedName, setSavedName] = useState(server.name)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [name, setName] = useState(server.name)
  const [isSaving, setIsSaving] = useState(false)
  const canManageServer = canManageTeamSettings(team.role)
  const hasChanges = name.trim() !== savedName

  async function save() {
    if (isSaving || !canManageServer || !hasChanges) return
    const parsed = serverNameSchema.safeParse(name)
    if (!parsed.success) {
      setNameError(
        parsed.error.issues[0]?.message ?? 'Enter a valid server name.',
      )
      document.getElementById('server-name')?.focus()
      return
    }
    setNameError(null)
    setSaveError(null)
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
      await afterMutation(async () => {
        await invalidateResourceQueries(queryClient, team.slug)
        await router.invalidate()
      }, 'The action completed, but refreshing the page failed. Please reload.')
    } catch (error) {
      setSaveError(getErrorMessage(error, 'Unable to save server.'))
    } finally {
      setIsSaving(false)
    }
  }

  function reset() {
    setSaveError(null)
    setNameError(null)
    setName(savedName)
  }

  return (
    <div className="space-y-8">
      <TeamHeading
        team={team}
        crumb={
          <>
            <Link
              className="hover:underline"
              to="/$teamSlug/servers"
              params={{ teamSlug: team.slug }}
            >
              Servers
            </Link>
            <span className="text-muted-foreground/25 font-normal">/</span>
            <span className="truncate">{savedName}</span>
          </>
        }
      />

      <SettingsLayout
        navigation={[
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
      >
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
              {server.agentUpdate.reason}{' '}
              {canManageServer ? (
                <>
                  Update manually with{' '}
                  <code>sudo /usr/local/lib/devpush/update-agent</code>.
                </>
              ) : (
                'Contact a workspace owner or admin to update the agent.'
              )}
            </AlertDescription>
          </Alert>
        )}

        <SettingsSection
          id="general"
          title="General"
          description="Basic details for this server."
          contentClassName="space-y-6"
          footer={
            canManageServer ? (
              <>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={reset}
                  disabled={!hasChanges || isSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="server-general-form"
                  disabled={!hasChanges || isSaving}
                >
                  {isSaving ? (
                    <LoaderIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : null}
                  Save
                </Button>
              </>
            ) : undefined
          }
        >
          <div className="space-y-2">
            <p className="text-sm font-medium">Status</p>
            <div className="flex items-center gap-2 text-sm">
              <ServerAvatar name={savedName} status={server.status} size="sm" />
              <span>{formatServerStatus(server.status)}</span>
              <span className="text-muted-foreground">
                ·{' '}
                {server.lastSeenAt
                  ? formatAge(server.lastSeenAt)
                  : 'Never contacted'}
              </span>
            </div>
          </div>

          <form
            id="server-general-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(nameError)}>
                <FieldLabel htmlFor="server-name">Name (required)</FieldLabel>
                <Input
                  id="server-name"
                  required
                  maxLength={100}
                  disabled={isSaving}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby="server-name-error"
                  value={name}
                  readOnly={!canManageServer}
                  onChange={(event) => {
                    setName(event.target.value)
                    setNameError(null)
                  }}
                />
                <FieldError id="server-name-error">{nameError}</FieldError>
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
                          onClick={() => void copyText(server.id, 'Server ID')}
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
            <FieldError role="alert">{saveError}</FieldError>
          </form>
        </SettingsSection>

        <SettingsSection
          id="host"
          title="Host"
          description="System information reported by the agent."
        >
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
                ? formatBytes(server.monitoring.latestMetrics.memoryTotalBytes)
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
        </SettingsSection>

        <SettingsSection
          id="metrics"
          title="Metrics"
          description="Up to 24 hours of host resource history. Missing samples remain visible as gaps."
          contentClassName="space-y-4"
        >
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
                      getValue: (sample) => sample.networkReceiveBytesPerSecond,
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
            <ServerMetricsEmpty />
          )}
        </SettingsSection>

        {canManageServer ? (
          <ServerDangerSection server={server} teamSlug={team.slug} />
        ) : null}
      </SettingsLayout>
    </div>
  )
}

export function ServerInstallCallout({
  server,
  teamSlug,
}: {
  server: Pick<ServerDetailData, 'id' | 'name' | 'status'>
  teamSlug: string
}) {
  const [installCommand, setInstallCommand] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createCommand() {
    if (isCreating || server.status === 'disabled') return
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
        ) : (
          <div className="space-y-3">
            {error ? <FieldError role="alert">{error}</FieldError> : null}
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
              {error ? 'Retry' : 'Generate install command'}
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function ServerDangerSection({
  server,
  teamSlug,
}: {
  server: Pick<ServerDetailData, 'id' | 'name' | 'status'>
  teamSlug: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
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
  const diagnosticRequest = useRef(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [serverDeleted, setServerDeleted] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const isDisabled = server.status === 'disabled'
  const canDisable =
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
      await afterMutation(async () => {
        await invalidateResourceQueries(queryClient, teamSlug)
        await router.invalidate()
      }, 'The action completed, but refreshing the page failed. Please reload.')
    } catch (error) {
      setActionError(
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
    const request = ++diagnosticRequest.current
    setIsLoadingDeleteDiagnostic(true)
    setDeleteDiagnostic(null)
    setDeleteDiagnosticError(null)

    try {
      const diagnostic = await getDeleteServerDiagnostic({
        data: { teamSlug, serverId: server.id },
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
      await afterMutation(async () => {
        await invalidateResourceQueries(queryClient, teamSlug)
        await router.navigate({
          to: '/$teamSlug/servers',
          params: { teamSlug },
        })
      }, 'The action completed, but opening the next page failed. Please reload.')
    } catch (error) {
      setActionError(getErrorMessage(error, 'Unable to delete server.'))
    } finally {
      setIsDeleting(false)
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

  function onStatusOpenChange(open: boolean) {
    if (isChangingStatus || isDeleting || serverDeleted) return
    setActionError(null)
    setStatusDialogOpen(open)

    if (!open) {
      setDisableConfirmation('')
    }
  }

  return (
    <SettingsSection
      id="danger"
      title="Danger"
      description="Administrative actions that affect this server."
      contentClassName="flex flex-col items-start gap-2"
    >
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
                required
                id="disable-server-confirmation"
                placeholder={server.name}
                value={disableConfirmation}
                onChange={(event) => setDisableConfirmation(event.target.value)}
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
          <FieldError role="alert">{actionError}</FieldError>
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
          <Button variant="destructive" disabled={isDeleting || serverDeleted}>
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
                id="delete-server-cancel-deployments"
                checked={cancelOngoingDeployments}
                onCheckedChange={(checked) =>
                  setCancelOngoingDeployments(checked === true)
                }
                disabled={isDeleting || serverDeleted}
              />
              <FieldLabel htmlFor="delete-server-cancel-deployments">
                Cancel ongoing deployments on this server
              </FieldLabel>
            </Field>

            <Field>
              <Input
                aria-label={`Type ${server.name} to confirm`}
                required
                id="delete-server-confirmation"
                placeholder={server.name}
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canDelete) {
                    event.preventDefault()
                    void deleteCurrentServer()
                  }
                }}
                disabled={isDeleting || serverDeleted}
              />
            </Field>
          </div>

          <FieldError role="alert">{actionError}</FieldError>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting || serverDeleted}>
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
    </SettingsSection>
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

export function formatPercent(value: number | null) {
  if (value === null) {
    return 'Not reported'
  }

  return `${value.toFixed(1)}%`
}

export function formatByteRatio(used: number | null, total: number | null) {
  if (used === null || total === null || total <= 0) {
    return 'Not reported'
  }

  return `${formatBytes(used)} / ${formatBytes(total)}`
}

function formatBytesPerSecond(value: number | null) {
  return value === null ? 'Not reported' : `${formatBytes(value)}/s`
}

export function formatNetworkSummary(
  received: number | null,
  sent: number | null,
) {
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

export function ServerMetricsEmpty() {
  return (
    <Empty className="min-h-40 border">
      <EmptyHeader>
        <EmptyTitle>No metrics reported yet.</EmptyTitle>
        <EmptyDescription>
          Metrics will appear after the agent reports host data.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
