import { LogKeywordFilter } from './log-keyword-filter'
import { navigateFilters, refreshView } from '@/lib/action-feedback'
import {
  Link,
  useParams,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import {
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  LoaderIcon,
  RefreshCwIcon,
  CircleAlertIcon,
} from 'lucide-react'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { ProjectHeading } from './project-heading'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { LogScrollArea } from '@/features/logs/log-scroll-area'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import type { ProjectLogsContext } from '@/server/projects/types'
import { invalidateProjectLogs } from '@/lib/project-context-query'

export function ProjectLogs({ context }: { context: ProjectLogsContext }) {
  const { deployments, filters, hasAnyLogs, logs, project } = context
  const params = useParams({ strict: false })
  const router = useRouter()
  const queryClient = useQueryClient()
  const isFiltering = useRouterState({
    select: (state) => state.status === 'pending',
  })
  const teamSlug =
    typeof params.teamSlug === 'string' ? params.teamSlug : context.team.slug
  const projectName =
    typeof params.projectName === 'string' ? params.projectName : project.name
  const refresh = useCallback(() => {
    void refreshView(
      () =>
        invalidateProjectLogs(queryClient, {
          teamSlug,
          projectName,
          ...filters,
        }),
      'projects-project-logs-refresh',
    )
  }, [filters, projectName, queryClient, teamSlug])
  const updateFilters = useCallback(
    (next: {
      branch?: string | null
      date?: string | null
      deploymentId?: string | null
      environmentId?: string | null
      keyword?: string | null
    }) => {
      void navigateFilters(() =>
        router.navigate({
          to: '/$teamSlug/projects/$projectName/logs',
          params: { teamSlug, projectName },
          search: (current) => ({
            branch:
              next.branch === undefined
                ? (current.branch ?? undefined)
                : next.branch || undefined,
            date:
              next.date === undefined
                ? (current.date ?? undefined)
                : next.date || undefined,
            deploymentId:
              next.deploymentId === undefined
                ? (current.deploymentId ?? undefined)
                : next.deploymentId || undefined,
            environmentId:
              next.environmentId === undefined
                ? (current.environmentId ?? undefined)
                : next.environmentId || undefined,
            keyword:
              next.keyword === undefined
                ? (current.keyword ?? undefined)
                : next.keyword || undefined,
          }),
        }),
      )
    },
    [projectName, router, teamSlug],
  )
  const selectedDeployment = deployments.find(
    (deployment) => deployment.id === filters.deploymentId,
  )
  const selectedEnvironment = context.environments.find(
    (environment) => environment.id === filters.environmentId,
  )
  const selectedDeploymentLabel =
    filters.deploymentId == null
      ? 'All deployments'
      : (selectedDeployment?.gitSha ?? filters.deploymentId).slice(0, 7)
  const selectedEnvironmentLabel =
    filters.environmentId == null
      ? 'All environments'
      : (selectedEnvironment?.name ?? 'All environments')
  const selectedDateLabel =
    filters.date === 'today'
      ? 'Today'
      : filters.date === '24h'
        ? 'Last 24 hours'
        : filters.date === '7d'
          ? 'Last 7 days'
          : filters.date === '30d'
            ? 'Last 30 days'
            : 'All dates'
  const selectedBranchLabel = filters.branch ?? 'All branches'
  const branches = Array.from(
    new Set(
      deployments.map((deployment) => deployment.gitBranch).filter(Boolean),
    ),
  )
  const hasFilters = Boolean(
    filters.branch ||
    filters.date ||
    filters.deploymentId ||
    filters.environmentId ||
    filters.keyword,
  )
  const logFollowKey =
    logs.at(-1) == null
      ? 'empty'
      : `${logs.at(-1)?.source}:${logs.at(-1)?.deploymentId ?? logs.at(-1)?.runtimeId}:${logs.at(-1)?.stream}:${logs.at(-1)?.seq}`

  return (
    <>
      <ProjectHeading
        teamSlug={teamSlug}
        project={project}
        crumbs={[<span className="truncate">Logs</span>]}
      />

      <section className="space-y-8">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <LogKeywordFilter
              value={filters.keyword ?? ''}
              onChange={(keyword) => updateFilters({ keyword })}
            />

            <Select
              value={filters.deploymentId ?? 'all'}
              onValueChange={(value) => {
                updateFilters({
                  deploymentId: value === 'all' ? null : value,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue>
                  <DeploymentFilterLabel
                    label={selectedDeploymentLabel}
                    status={selectedDeployment?.status}
                  />
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All deployments</SelectItem>
                {deployments.map((deployment) => (
                  <SelectItem value={deployment.id} key={deployment.id}>
                    <DeploymentFilterLabel
                      label={
                        deployment.gitSha !== 'pending'
                          ? deployment.gitSha.slice(0, 7)
                          : deployment.id.slice(0, 7)
                      }
                      status={deployment.status}
                    />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.environmentId ?? 'all'}
              onValueChange={(value) => {
                updateFilters({
                  environmentId: value === 'all' ? null : value,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue>
                  <EnvironmentFilterLabel
                    color={selectedEnvironment?.color}
                    label={selectedEnvironmentLabel}
                  />
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All environments</SelectItem>
                {context.environments.map((environment) => (
                  <SelectItem value={environment.id} key={environment.id}>
                    <EnvironmentFilterLabel
                      color={environment.color}
                      label={environment.name}
                    />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.date ?? 'all'}
              onValueChange={(value) => {
                updateFilters({
                  date: value === 'all' ? null : value,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue>{selectedDateLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All dates</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.branch ?? 'all'}
              onValueChange={(value) => {
                updateFilters({
                  branch: value === 'all' ? null : value,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue>{selectedBranchLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((branch) => (
                  <SelectItem value={branch} key={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters ? (
              <Button
                variant="ghost"
                onClick={() => {
                  updateFilters({
                    branch: null,
                    date: null,
                    deploymentId: null,
                    environmentId: null,
                    keyword: null,
                  })
                }}
              >
                Reset filters
              </Button>
            ) : null}
            <div className="ml-auto">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Refresh"
                    onClick={refresh}
                  >
                    <RefreshCwIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
            </div>
            {isFiltering ? (
              <div className="flex items-center gap-x-1.5 text-xs text-muted-foreground">
                <LoaderIcon className="size-3.5 shrink-0 animate-spin" />
                Filtering
              </div>
            ) : null}
          </div>

          <LogScrollArea
            followKey={logFollowKey}
            className="relative h-[500px] rounded-lg border p-2 text-card-foreground transition-opacity data-[filtering=true]:opacity-60"
            data-filtering={isFiltering}
            aria-busy={isFiltering}
          >
            {logs.length > 0 ? (
              <LogList logs={logs} />
            ) : (
              <div className="absolute inset-0 flex p-4">
                <Empty className="border-0">
                  <EmptyHeader>
                    <EmptyTitle>
                      {hasAnyLogs ? 'No logs for these filters' : 'No logs yet'}
                    </EmptyTitle>
                    <EmptyDescription>
                      {hasAnyLogs
                        ? 'Try changing or clearing the selected filters.'
                        : 'Deploy the project or reconnect the server to collect runtime logs.'}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="flex-row justify-center">
                    <Button variant="outline" onClick={refresh}>
                      Refresh logs
                    </Button>
                    {hasFilters ? (
                      <Button asChild>
                        <Link
                          to="/$teamSlug/projects/$projectName/logs"
                          params={{ teamSlug, projectName }}
                        >
                          Reset filters
                        </Link>
                      </Button>
                    ) : null}
                  </EmptyContent>
                </Empty>
              </div>
            )}
          </LogScrollArea>
        </div>
      </section>
    </>
  )
}

function DeploymentFilterLabel({
  label,
  status,
}: {
  label: string
  status?: ProjectLogsContext['deployments'][number]['status']
}) {
  return (
    <span className="flex items-center gap-2">
      {status ? <StatusFilterIcon status={status} /> : null}
      {label}
    </span>
  )
}

function EnvironmentFilterLabel({
  color,
  label,
}: {
  color?: string
  label: string
}) {
  return (
    <span className="flex items-center gap-2">
      {color ? <EnvironmentDot color={color} /> : null}
      {label}
    </span>
  )
}

function StatusFilterIcon({
  status,
}: {
  status: ProjectLogsContext['deployments'][number]['status']
}) {
  if (status === 'succeeded') {
    return (
      <CircleCheckIcon
        className="size-4 shrink-0 text-success"
      />
    )
  }

  if (status === 'failed') {
    return (
      <CircleAlertIcon
        className="size-4 shrink-0 text-destructive"
      />
    )
  }

  if (status === 'canceled') {
    return (
      <CircleXIcon
        className="size-4 shrink-0 text-muted-foreground"
      />
    )
  }

  if (status === 'queued') {
    return (
      <Clock3Icon
        className="size-4 shrink-0 text-muted-foreground"
      />
    )
  }

  return (
    <LoaderIcon
      className="size-4 shrink-0 animate-spin text-muted-foreground"
    />
  )
}

function LogList({ logs }: { logs: ProjectLogsContext['logs'] }) {
  return (
    <div>
      {logs.map((log, index) => (
        <div
          className="flex items-start gap-x-4 rounded-md px-2 py-1.5 font-mono text-[13px] transition-colors hover:bg-muted"
          key={`${log.source}:${log.deploymentId ?? log.runtimeId}:${log.stream}:${log.seq}:${index}`}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <time
                className="whitespace-nowrap text-muted-foreground"
                dateTime={log.createdAt}
              >
                {formatLogTime(log.createdAt)}
              </time>
            </TooltipTrigger>
            <TooltipContent>{formatLogTooltip(log.createdAt)}</TooltipContent>
          </Tooltip>
          <Badge variant="secondary" className="font-mono">
            {log.source === 'deployment'
              ? log.deploymentId?.slice(0, 7)
              : (log.service ?? log.runtimeId?.slice(0, 7))}
          </Badge>
          <div className="min-w-0 break-all whitespace-pre-wrap">
            {log.content}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatLogTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function formatLogTooltip(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(new Date(value))
}
