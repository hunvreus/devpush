import {
  formatPercent,
  formatByteRatio,
  formatNetworkSummary,
} from './server-metric-format'
import { CopyButton } from '#devpush/components/copy-button'
import {
  getRouteApi,
  Link,
  useParams,
  useHydrated,
} from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import {
  SettingsLayout,
  SettingsSection,
} from '#devpush/components/settings-layout'
import { TeamHeading } from '#devpush/features/teams/team-heading'
import { Button } from '#devpush/components/ui/button'
import { Input } from '#devpush/components/ui/input'
import { BanIcon, Trash2Icon } from 'lucide-react'
import { ServerMetricChartPending } from './server-metric-chart-pending'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from '#devpush/components/ui/input-group'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '#devpush/components/ui/field'
import { ServerAvatar } from './server-avatar'
import { ServerDetail, ServerInstallCallout } from './server-detail'
import { formatServerStatus, formatAge } from './team-servers'
import { canManageTeamSettings } from '#devpush/lib/team-role'
import type { ServerSummary } from '#devpush/server/teams/types'
import type { getTeamServerContext } from '#devpush/server/servers/functions'
import { Skeleton } from '#devpush/components/ui/skeleton'
import { getCachedTeamContexts } from '#devpush/lib/team-context-query'
import { displayNameFromSlug } from '#devpush/lib/display-name'

const teamRoute = getRouteApi('/$teamSlug')

export function ServerDetailPending() {
  const params = useParams({ strict: false })
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  const routeContext = teamRoute.useLoaderData()
  const context = hydrated ? routeContext : undefined
  const serverId = typeof params.serverId === 'string' ? params.serverId : ''
  const teamSlug =
    typeof params.teamSlug === 'string' ? params.teamSlug : 'team'
  const cachedContexts = hydrated
    ? getCachedTeamContexts(queryClient, teamSlug)
    : []
  const server =
    context?.servers.find((item) => item.id === serverId) ??
    cachedContexts
      .flatMap((item) => item.servers)
      .find((item) => item.id === serverId)
  const team = context?.team ?? cachedContexts.at(0)?.team
  const cachedDetail = queryClient.getQueryData<
    NonNullable<Awaited<ReturnType<typeof getTeamServerContext>>>
  >(['server-context', teamSlug, serverId])
  const detail = hydrated ? cachedDetail : undefined
  const canManage = Boolean(team && canManageTeamSettings(team.role))
  const metrics = server?.monitoring.latestMetrics
  const teamName = team?.name ?? displayNameFromSlug(teamSlug)

  if (detail) return <ServerDetail server={detail.server} team={detail.team} />

  return (
    <div className="space-y-8" aria-label="Loading server" aria-busy="true">
      <TeamHeading
        team={
          team ?? {
            name: teamName,
            slug: teamSlug,
          }
        }
        crumb={
          <>
            <Link
              className="hover:underline"
              to="/$teamSlug/servers"
              params={{ teamSlug }}
            >
              Servers
            </Link>
            <span className="text-muted-foreground/25 font-normal">/</span>
            <span className="truncate">
              {server?.name ?? <Skeleton className="h-6 w-32" />}
            </span>
          </>
        }
      />
      <SettingsLayout
        navigation={[
          { href: '#general', label: 'General' },
          { href: '#host', label: 'Host' },
          { href: '#metrics', label: 'Metrics' },
          ...(canManage || !team
            ? [{ href: '#danger' as const, label: 'Danger', destructive: true }]
            : []),
        ]}
      >
        {server && canManage && server.status !== 'connected' ? (
          <ServerInstallCallout server={server} teamSlug={teamSlug} />
        ) : null}
        <ServerGeneralPending
          server={server}
          serverId={serverId}
          canManage={canManage}
          permissionsPending={!team}
        />
        <ServerHostPending server={server} />
        <SettingsSection
          id="metrics"
          title="Metrics"
          description="Up to 24 hours of host resource history. Missing samples remain visible as gaps."
          contentClassName="space-y-4"
        >
          {/* Shell summaries omit monitoring; null is unresolved here, not empty. */}
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                label: 'CPU usage',
                latestValue: metrics
                  ? formatPercent(metrics.cpuPercent)
                  : undefined,
              },
              {
                label: 'Memory usage',
                latestValue: metrics
                  ? formatByteRatio(
                      metrics.memoryUsedBytes,
                      metrics.memoryTotalBytes,
                    )
                  : undefined,
              },
              {
                label: 'Disk usage',
                latestValue: metrics
                  ? formatByteRatio(
                      metrics.diskUsedBytes,
                      metrics.diskTotalBytes,
                    )
                  : undefined,
              },
              {
                label: 'Network traffic',
                latestValue: metrics
                  ? formatNetworkSummary(
                      metrics.networkReceiveBytesPerSecond,
                      metrics.networkTransmitBytesPerSecond,
                    )
                  : undefined,
              },
            ].map((metric) => (
              <ServerMetricChartPending key={metric.label} {...metric} />
            ))}
          </div>
        </SettingsSection>
        {canManage || !team ? (
          <SettingsSection
            id="danger"
            title="Danger"
            description="Administrative actions that affect this server."
            contentClassName="flex flex-col items-start gap-2"
          >
            <Button
              variant={
                server?.status === 'disabled' ? 'default' : 'destructive'
              }
              disabled
            >
              {server?.status !== 'disabled' ? (
                <BanIcon data-icon="inline-start" />
              ) : null}
              {server?.status === 'disabled'
                ? 'Enable server'
                : 'Disable server'}
            </Button>
            <Button variant="destructive" disabled>
              <Trash2Icon data-icon="inline-start" />
              Delete server
            </Button>
          </SettingsSection>
        ) : null}
      </SettingsLayout>
    </div>
  )
}

function ServerGeneralPending({
  server,
  serverId,
  canManage,
  permissionsPending,
}: {
  server?: ServerSummary
  serverId: string
  canManage: boolean
  permissionsPending: boolean
}) {
  return (
    <SettingsSection
      id="general"
      title="General"
      description="Basic details for this server."
      contentClassName="space-y-6"
      footer={
        canManage || permissionsPending ? (
          <>
            <Button variant="ghost" disabled>
              Cancel
            </Button>
            <Button disabled>Save</Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-2">
        <p className="text-sm font-medium">Status</p>
        <div className="flex items-center gap-2 text-sm">
          {server ? (
            <>
              <ServerAvatar
                name={server.name}
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
            </>
          ) : (
            <Skeleton className="h-5 w-36" />
          )}
        </div>
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel>Name</FieldLabel>
          {server ? (
            <Input value={server.name} readOnly disabled />
          ) : (
            <Skeleton className="h-8 w-full" />
          )}
        </Field>
        <Field>
          <FieldLabel>Server ID</FieldLabel>
          <InputGroup>
            <InputGroupInput
              className="font-mono text-[13px] text-muted-foreground"
              value={serverId}
              readOnly
            />
            <InputGroupAddon align="inline-end">
              <CopyButton value={serverId} label="Copy server ID" inputGroup />
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>
            A unique identifier used by the API and agent.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </SettingsSection>
  )
}

function ServerHostPending({ server }: { server?: ServerSummary }) {
  return (
    <SettingsSection
      id="host"
      title="Host"
      description="System information reported by the agent."
    >
      <dl className="grid gap-6 text-sm sm:grid-cols-2">
        {[
          'Public IPv4',
          'Public IPv6',
          'Hostname',
          'Operating system',
          'CPU',
          'Memory',
          'Architecture',
          'Host uptime',
          'Kernel',
          'Agent version',
        ].map((label, index) => (
          <div className="min-w-0 space-y-1.5" key={index}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            {server && !server.lastSeenAt && label !== 'Agent version' ? (
              <dd className="text-sm break-words">Not reported</dd>
            ) : label === 'Agent version' && server ? (
              <dd className="text-sm break-words">
                {server.agentVersion ?? 'Not reported'}
              </dd>
            ) : (
              <Skeleton className={index % 3 === 0 ? 'h-5 w-40' : 'h-5 w-28'} />
            )}
          </div>
        ))}
      </dl>
    </SettingsSection>
  )
}
