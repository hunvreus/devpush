import { mutationErrorOptions, afterMutation  } from '#devpush/lib/action-feedback'
import { useSettingsVersion } from '#devpush/lib/use-settings-version'
import { showSettingsConflict } from '#devpush/lib/settings-conflict'
import { CopyButton } from '#devpush/components/copy-button'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateResourceQueries } from '#devpush/lib/resource-cache'
import { serverNameSchema } from '#devpush/lib/server-name-schema'
import { Link, useRouter } from '@tanstack/react-router'
import {
  BanIcon,
  LoaderIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from 'lucide-react'
import { useRef, useState, lazy, Suspense } from 'react'
import { toast } from 'sonner'

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '#devpush/components/ui/alert'
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
} from '#devpush/components/ui/alert-dialog'
import { Button } from '#devpush/components/ui/button'
import { Badge } from '#devpush/components/ui/badge'
import { Checkbox } from '#devpush/components/ui/checkbox'

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'
import {
  SettingsLayout,
  SettingsSection,
} from '#devpush/components/settings-layout'
import { TeamHeading } from '#devpush/features/teams/team-heading'
import { ServerAvatar } from '#devpush/features/servers/server-avatar'
import {
  ServerMetricsPending,
  ServerMetricsEmpty,
} from './server-metrics-pending'
import { formatBytes } from './server-metric-format'

import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { canManageTeamSettings } from '#devpush/lib/team-role'
import {
  formatAge,
  formatServerStatus,
  getInstallDescription,
  InstallCommand,
} from '#devpush/features/servers/team-servers'
import {
  createInstallCommand,
  deleteServer,
  disableServer,
  enableServer,
  getDeleteServerDiagnostic,
  updateServer,
} from '#devpush/server/servers/functions'

import type {
  ServerDeleteDiagnostic,
  ServerDetail as ServerDetailData,
  ServerInstallCommand,
} from '#devpush/server/servers/service'
import type { TeamSummary } from '#devpush/server/teams/types'

const ServerMetrics = lazy(() =>
  import('./server-metrics').then((module) => ({
    default: module.ServerMetrics,
  })),
)

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
  const [nameError, setNameError] = useState<string | null>(null)
  const [name, setName] = useState(server.name)
  const [isSaving, setIsSaving] = useState(false)
  const canManageServer = canManageTeamSettings(team.role)
  const hasChanges = name.trim() !== savedName

  const settingsVersion = useSettingsVersion({
    version: server.settingsVersion,
    dirty: hasChanges,
    saving: isSaving,
    refresh: () => {
      setName(server.name)
      setSavedName(server.name)
      setNameError(null)
    },
  })

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

    setIsSaving(true)

    try {
      const result = await updateServer({
        data: {
          teamSlug: team.slug,
          serverId: server.id,
          settingsVersion: settingsVersion.current,
          name,
        },
      })
      settingsVersion.current = result.settingsVersion
      const nextName = name.trim()
      setName(nextName)
      setSavedName(nextName)
      toast.success('Server saved.')
      await afterMutation(async () => {
        await invalidateResourceQueries(queryClient, team.slug)
        await router.invalidate()
      }, 'The action completed, but refreshing the page failed. Please reload.')
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(error, 'Unable to save server.'),
        ...mutationErrorOptions(error),
      )
    } finally {
      setIsSaving(false)
    }
  }

  function reset() {
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
                <FieldLabel htmlFor="server-name">Name</FieldLabel>
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
                    <CopyButton
                      value={server.id}
                      label="Copy server ID"
                      inputGroup
                    />
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  A unique identifier used by the API and agent.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </SettingsSection>

        <SettingsSection
          id="host"
          title="Host"
          description="System information reported by the agent."
        >
          <dl className="grid gap-6 text-sm sm:grid-cols-2">
            <ServerDetailField label="Public IPv4">
              {server.publicIpv4 ?? 'Not reported'}
            </ServerDetailField>
            <ServerDetailField label="Public IPv6">
              {server.publicIpv6 ?? 'Not reported'}
            </ServerDetailField>
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
            <Suspense
              fallback={
                <ServerMetricsPending
                  latestMetrics={server.monitoring.latestMetrics}
                />
              }
            >
              <ServerMetrics
                serverId={server.id}
                teamSlug={team.slug}
                latestMetrics={server.monitoring.latestMetrics}
              />
            </Suspense>
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

  async function createCommand() {
    if (isCreating || server.status === 'disabled') return
    setIsCreating(true)

    try {
      const result: ServerInstallCommand = await createInstallCommand({
        data: {
          teamSlug,
          serverId: server.id,
        },
      })
      setInstallCommand(result.installCommand)
    } catch (cause) {
      if (showSettingsConflict(cause)) return
      toast.error(
        getPublicErrorMessage(cause, 'Unable to create install command.'),
        ...mutationErrorOptions(cause),
      )
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
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          isDisabled ? 'Unable to enable server.' : 'Unable to disable server.',
        ),
        ...mutationErrorOptions(error),
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
      if (showSettingsConflict(error)) return
      if (request !== diagnosticRequest.current) return
      setDeleteDiagnosticError(
        getPublicErrorMessage(error, 'Unable to inspect server usage.'),
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
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(error, 'Unable to delete server.'),
        ...mutationErrorOptions(error),
      )
    } finally {
      setIsDeleting(false)
    }
  }

  function onDeleteOpenChange(open: boolean) {
    if (isDeleting || isChangingStatus || serverDeleted) return
    diagnosticRequest.current += 1

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
                : `This blocks agent communication and new work for ${server.name}. Running apps stay online; queued work waits and active jobs may time out. Type "${server.name}" to confirm.`}
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
    <div className="min-w-0 space-y-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
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
