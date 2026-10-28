import { DeploymentVisitLinks } from './deployment-visit-links'
import { DeploymentAliasBadge } from './deployment-alias-badge'
import { Link } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  LoaderIcon,
  MoreHorizontalIcon,
  CircleAlertIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#devpush/components/ui/button'
import {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertAction,
} from '#devpush/components/ui/alert'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '#devpush/components/ui/dropdown-menu'
import { ProjectHeading } from '#devpush/features/projects/project-heading'
import { routeUrl } from '#devpush/lib/urls'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#devpush/components/ui/tooltip'
import { EnvironmentDot } from '#devpush/features/projects/environment-dot'
import { DeploymentActions } from '#devpush/features/deployments/deployment-actions'
import { LogScrollArea } from '#devpush/features/logs/log-scroll-area'
import { ServerAvatar } from '#devpush/features/servers/server-avatar'
import type {
  PluginContext,
  DeploymentSummary,
} from '#devpush/server/projects/types'
import { deploymentLogsQueryOptions } from '#devpush/lib/deployment-logs-query'

export function DeploymentDetail({
  context,
  unavailable = false,
}: {
  context: PluginContext
  unavailable?: boolean
}) {
  const { deployment, project } = context
  const queryClient = useQueryClient()
  const [now, setNow] = useState(() => Date.now())
  const shouldRefresh =
    deployment.status === 'queued' || deployment.status === 'running'
  const {
    data: logs = [],
    isPending: logsPending,
    error: logsError,
    refetch: reloadLogs,
    isFetching: logsFetching,
  } = useQuery({
    ...deploymentLogsQueryOptions({
      completed: !shouldRefresh,
      deploymentId: deployment.id,
      projectName: project.name,
      teamSlug: context.team.slug,
      queryClient,
    }),
  })
  const visitUrl = deployment.deploymentHost
    ? routeUrl({
        host: deployment.deploymentHost,
        https: deployment.deploymentRouteHttps,
      })
    : null
  const canVisit =
    deployment.status === 'succeeded' &&
    deployment.isServing !== false &&
    visitUrl !== null
  const logFollowKey =
    logs.at(-1) == null ? 'empty' : `${logs.at(-1)?.stream}:${logs.at(-1)?.seq}`

  useEffect(() => {
    if (!shouldRefresh) {
      return
    }

    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => window.clearInterval(interval)
  }, [shouldRefresh])

  return (
    <>
      <section className="space-y-8">
        {unavailable && deployment.isServing === false ? (
          <Alert className="mb-6">
            <TriangleAlertIcon />
            <AlertTitle>Deployment is not active</AlertTitle>
            <AlertDescription>
              This revision is no longer serving traffic. Redeploy it to replace
              the current version using its saved configuration.
            </AlertDescription>
            <AlertAction>
              <DeploymentActions
                deployment={deployment}
                teamSlug={context.team.slug}
                trigger="redeploy"
              />
            </AlertAction>
          </Alert>
        ) : null}
        <ProjectHeading
          teamSlug={context.team.slug}
          project={project}
          crumbs={[
            <Link
              to="/$teamSlug/projects/$projectName/deployments"
              params={{
                teamSlug: context.team.slug,
                projectName: project.name,
              }}
              className="truncate hover:underline"
            >
              Deployments
            </Link>,
            <span className="truncate font-mono">
              {shortDeploymentId(deployment.id)}
            </span>,
          ]}
          actions={
            <div className="flex items-center gap-2">
              <DeploymentVisitLinks
                canVisit={canVisit}
                visitUrl={visitUrl}
                aliases={context.visitAliases}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Deployment options"
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DeploymentActions
                  deployment={deployment}
                  teamSlug={context.team.slug}
                />
              </DropdownMenu>
            </div>
          }
        />

        <DeploymentMetadata
          deployment={deployment}
          deployments={context.latestDeployments}
          teamSlug={context.team.slug}
          projectName={project.name}
          now={now}
        />
      </section>

      <section className="space-y-4">
        <DeploymentFailureAlert deployment={deployment} />
        <LogScrollArea
          followKey={logFollowKey}
          className="relative h-[500px] rounded-lg border border-border p-2"
        >
          {logsPending ? (
            <DeploymentLogsPending />
          ) : logsError && logs.length === 0 ? null : logs.length > 0 ? (
            logs.map((line) => (
              <div
                key={`${line.stream}:${line.seq}`}
                className="flex items-start gap-x-4 rounded-md px-2 py-1.5 font-mono text-[13px] transition-colors hover:bg-muted"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <time
                      className="whitespace-nowrap text-muted-foreground"
                      dateTime={line.createdAt}
                    >
                      {formatDetailLogTime(line.createdAt)}
                    </time>
                  </TooltipTrigger>
                  <TooltipContent>
                    {formatLogTooltip(line.createdAt)}
                  </TooltipContent>
                </Tooltip>
                <div className="min-w-0 break-all whitespace-pre-wrap">
                  {line.content}
                </div>
              </div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              No logs found
            </div>
          )}
        </LogScrollArea>
        <footer className="flex min-h-8 items-start justify-between gap-4">
          {logsError && !logsFetching ? (
            <Alert variant="destructive" className="min-w-0 flex-1">
              <TriangleAlertIcon />
              <AlertTitle>
                {logs.length > 0
                  ? 'Couldn’t refresh deployment logs'
                  : 'Couldn’t load deployment logs'}
              </AlertTitle>
              <AlertDescription>
                {logs.length > 0
                  ? 'Displayed logs may be incomplete.'
                  : 'Please try again.'}
              </AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logsFetching}
                  onClick={() => void reloadLogs()}
                >
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          ) : (
            <span />
          )}
          <Button variant="outline" size="sm" asChild>
            <Link
              to="/$teamSlug/projects/$projectName/logs"
              params={{
                teamSlug: context.team.slug,
                projectName: project.name,
              }}
              search={{ deploymentId: deployment.id }}
            >
              All logs
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        </footer>
      </section>
    </>
  )
}

export function DeploymentFailureAlert({
  deployment,
}: {
  deployment: Pick<DeploymentSummary, 'status' | 'errorMessage'>
}) {
  if (deployment.status !== 'failed') return null
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Deployment failed</AlertTitle>
      <AlertDescription>
        {deployment.errorMessage || 'The deployment could not be completed.'}
      </AlertDescription>
    </Alert>
  )
}

export function DeploymentMetadata({
  deployment,
  deployments,
  teamSlug,
  projectName,
  now = Date.now(),
}: {
  deployment: DeploymentSummary
  deployments: Array<DeploymentSummary>
  teamSlug: string
  projectName: string
  now?: number
}) {
  const hasGitSha = deployment.gitSha !== 'pending'
  const deploymentAlias = getDeploymentAlias({
    deployment,
    latestDeployments: deployments,
    project: { name: projectName },
  })
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <li className="w-28 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <DeploymentStatus status={deployment.status} />
              </span>
            </TooltipTrigger>
            <TooltipContent>Status</TooltipContent>
          </Tooltip>
        </li>
        <li className="min-w-16 tabular-nums">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-x-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
                <Clock3Icon />
                {formatDuration({
                  createdAt: deployment.createdAt,
                  finishedAt: deployment.finishedAt,
                  now,
                  startedAt: deployment.startedAt,
                  status: deployment.status,
                })}
              </span>
            </TooltipTrigger>
            <TooltipContent>Duration</TooltipContent>
          </Tooltip>
        </li>
        <li className="h-5 min-w-20">
          <DeploymentAliasBadge alias={deploymentAlias} />
        </li>
      </ul>

      <ul className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <li>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/$teamSlug/projects/$projectName/deployments"
                params={{
                  teamSlug: teamSlug,
                  projectName: projectName,
                }}
                search={{ environment: deployment.environmentSlug }}
                className="flex items-center gap-x-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <EnvironmentDot color={deployment.environmentColor} />
                {deployment.environmentName}
              </Link>
            </TooltipTrigger>
            <TooltipContent>Environment</TooltipContent>
          </Tooltip>
        </li>

        <li>
          <Tooltip>
            <TooltipTrigger asChild>
              {deployment.serverId ? (
                <Link
                  to="/$teamSlug/servers/$serverId"
                  params={{
                    teamSlug: teamSlug,
                    serverId: deployment.serverId,
                  }}
                  className="flex items-center gap-x-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ServerAvatar
                    size="sm"
                    name={deployment.serverName}
                    status={deployment.serverStatus}
                  />
                  {deployment.serverName}
                </Link>
              ) : (
                <span className="flex items-center gap-x-2 text-muted-foreground">
                  <ServerAvatar
                    size="sm"
                    name={deployment.serverName}
                    status={deployment.serverStatus}
                  />
                  {deployment.serverName}
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent>
              {deployment.serverId ? 'View server' : 'Server'}
            </TooltipContent>
          </Tooltip>
        </li>

        <li className="min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`https://github.com/${deployment.githubRepo}/tree/${deployment.gitBranch}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-x-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
              >
                <GitBranchIcon />
                <span className="truncate">{deployment.gitBranch}</span>
              </a>
            </TooltipTrigger>
            <TooltipContent>Branch</TooltipContent>
          </Tooltip>
        </li>

        <li className="min-w-0 max-w-1/2">
          <Tooltip>
            <TooltipTrigger asChild>
              {hasGitSha ? (
                <a
                  className="flex min-w-0 items-center gap-x-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:shrink-0 [&>svg]:opacity-50"
                  href={`https://github.com/${deployment.githubRepo}/commit/${deployment.gitSha}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GitCommitHorizontalIcon className="size-5 shrink-0" />
                  <span className="truncate">
                    {deployment.commitMessage ??
                      getDeploymentFallbackMessage(deployment)}
                  </span>
                </a>
              ) : (
                <span className="flex min-w-0 items-center gap-x-2 text-muted-foreground [&>svg]:shrink-0 [&>svg]:opacity-50">
                  <GitCommitHorizontalIcon className="size-5 shrink-0" />
                  <span className="truncate">
                    {deployment.commitMessage ??
                      getDeploymentFallbackMessage(deployment)}
                  </span>
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent>
              {hasGitSha
                ? `Commit (${deployment.gitSha.slice(0, 7)})`
                : 'Commit pending'}
            </TooltipContent>
          </Tooltip>
        </li>
      </ul>
    </div>
  )
}

export function DeploymentLogsPending() {
  return (
    <div
      role="status"
      className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <LoaderIcon className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      Loading logs
    </div>
  )
}

function DeploymentStatus({
  status,
}: {
  status: PluginContext['deployment']['status']
}) {
  if (status === 'succeeded') {
    return (
      <span className="flex items-center gap-2 text-success">
        <CircleCheckIcon className="size-4 shrink-0" />
        Succeeded
      </span>
    )
  }

  if (status === 'failed') {
    return (
      <span className="flex items-center gap-2 text-destructive">
        <CircleAlertIcon className="size-4 shrink-0" />
        Failed
      </span>
    )
  }

  if (status === 'canceled') {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <CircleXIcon className="size-4 shrink-0" />
        Canceled
      </span>
    )
  }

  if (status === 'queued') {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Clock3Icon className="size-4 shrink-0" />
        Queued
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2 text-muted-foreground">
      <LoaderIcon className="size-4 shrink-0 animate-spin" />
      Running
    </span>
  )
}

function formatDuration({
  createdAt,
  finishedAt,
  now,
  startedAt,
  status,
}: {
  createdAt: string
  finishedAt: string | null
  now: number
  startedAt: string | null
  status: PluginContext['deployment']['status']
}) {
  const start = new Date(startedAt ?? createdAt).getTime()
  const end =
    finishedAt !== null
      ? new Date(finishedAt).getTime()
      : status === 'queued' || status === 'running'
        ? now
        : null

  if (end === null) {
    return '0s'
  }

  const durationMs = end - start
  const seconds = Math.max(1, Math.round(durationMs / 1000))

  return `${seconds}s`
}

function getDeploymentAlias(context: {
  deployment: DeploymentSummary
  latestDeployments: Array<DeploymentSummary>
  project: { name: string }
}) {
  const succeeded = context.latestDeployments
    .filter(
      (deployment) =>
        deployment.status === 'succeeded' &&
        deployment.projectName === context.project.name &&
        deployment.environmentName === context.deployment.environmentName,
    )
    .sort(
      (first, second) =>
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime(),
    )

  if (succeeded[0]?.id === context.deployment.id) {
    return 'current'
  }

  if (succeeded[1]?.id === context.deployment.id) {
    return 'previous'
  }

  return null
}

function shortDeploymentId(id: string) {
  return id.slice(0, 7)
}

function getDeploymentFallbackMessage(deployment: PluginContext['deployment']) {
  if (deployment.errorMessage) {
    return deployment.errorMessage
  }

  if (deployment.trigger === 'user') {
    return 'Manual deploy'
  }

  return 'Deployment'
}

function formatDetailLogTime(value: string) {
  return new Intl.DateTimeFormat('en', {
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
