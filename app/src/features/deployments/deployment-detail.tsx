import { Link, useRouter } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  Link2Icon,
  LoaderIcon,
  MoreHorizontalIcon,
  SparkleIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResourceAvatar } from '@/components/resource-avatar'
import { routeUrl } from '@/lib/urls'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import { DeploymentActions } from '@/features/deployments/deployment-actions'
import { LogScrollArea } from '@/features/logs/log-scroll-area'
import { ServerAvatar } from '@/features/servers/server-avatar'
import type { DeploymentContext } from '@/server/projects/service'

export function DeploymentDetail({ context }: { context: DeploymentContext }) {
  const router = useRouter()
  const { deployment, environment, logs, project } = context
  const [now, setNow] = useState(() => Date.now())
  const deploymentAlias = getDeploymentAlias(context)
  const hasGitSha = deployment.gitSha !== 'pending'
  const shouldRefresh =
    deployment.status === 'queued' || deployment.status === 'running'
  const visitUrl = deployment.deploymentHost
    ? routeUrl({
        host: deployment.deploymentHost,
        https: deployment.deploymentRouteHttps,
      })
    : null
  const canVisit = deployment.status === 'succeeded' && visitUrl !== null
  const logFollowKey =
    logs.at(-1) == null ? 'empty' : `${logs.at(-1)?.stream}:${logs.at(-1)?.seq}`

  useEffect(() => {
    if (!shouldRefresh) {
      return
    }

    const interval = window.setInterval(() => {
      void router.invalidate()
    }, 2000)

    return () => window.clearInterval(interval)
  }, [router, shouldRefresh])

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
        <header className="flex items-start justify-between gap-8">
          <h1 className="flex min-w-0 items-center gap-x-3 text-2xl font-medium">
            <Link
              to="/$teamSlug/projects/$projectName"
              params={{
                teamSlug: context.team.slug,
                projectName: project.name,
              }}
              className="shrink-0"
            >
              <ResourceAvatar
                name={project.name}
                color={project.color}
                size="md"
              />
            </Link>
            <span className="text-muted-foreground/25 font-normal">/</span>
            <Link
              to="/$teamSlug/projects/$projectName/deployments"
              params={{
                teamSlug: context.team.slug,
                projectName: project.name,
              }}
              className="truncate hover:underline"
            >
              Deployments
            </Link>
            <span className="text-muted-foreground/25 font-normal">/</span>
            <span className="truncate font-mono">
              {shortDeploymentId(deployment.id)}
            </span>
          </h1>

          <div className="flex items-center gap-2">
            {canVisit ? (
              <Button asChild>
                <a href={visitUrl} target="_blank" rel="noreferrer">
                  <Link2Icon data-icon="inline-start" />
                  Visit
                </a>
              </Button>
            ) : (
              <Button disabled>
                <Link2Icon data-icon="inline-start" />
                Visit
              </Button>
            )}
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
        </header>

        <div className="space-y-4">
          <ul className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <li>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <DeploymentStatus status={deployment.status} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Status</TooltipContent>
              </Tooltip>
            </li>
            <li>
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
            {deploymentAlias === 'current' ? (
              <li className="h-5">
                <span className="inline-flex h-5 items-center gap-x-1 rounded-md bg-secondary px-2 text-xs font-medium text-secondary-foreground">
                  <SparkleIcon className="size-3 shrink-0" />
                  Current
                </span>
              </li>
            ) : deploymentAlias === 'previous' ? (
              <li className="h-5">
                <span className="inline-flex h-5 items-center rounded-md bg-secondary px-2 text-xs font-medium text-muted-foreground">
                  Previous
                </span>
              </li>
            ) : null}
          </ul>

          <ul className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <li>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/$teamSlug/projects/$projectName/deployments"
                    params={{
                      teamSlug: context.team.slug,
                      projectName: project.name,
                    }}
                    search={{ environment: environment.slug }}
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
                        teamSlug: context.team.slug,
                        serverId: deployment.serverId,
                      }}
                      className="flex items-center gap-x-2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ServerAvatar
                        name={deployment.serverName}
                        status={deployment.serverStatus}
                      />
                      {deployment.serverName}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-x-2 text-muted-foreground">
                      <ServerAvatar
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
                      className="flex min-w-0 items-center gap-x-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
                      href={`https://github.com/${deployment.githubRepo}/commit/${deployment.gitSha}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <GitCommitHorizontalIcon />
                      <span className="truncate">
                        {deployment.commitMessage ??
                          getDeploymentFallbackMessage(deployment)}
                      </span>
                    </a>
                  ) : (
                    <span className="flex min-w-0 items-center gap-x-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
                      <GitCommitHorizontalIcon />
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
      </section>

      <section className="space-y-4">
        <LogScrollArea
          followKey={logFollowKey}
          className="relative h-[500px] rounded-lg border border-border p-2"
        >
          {logs.length > 0 ? (
            logs.map((line) => (
              <div
                key={line.seq}
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
            <div className="flex h-full items-center justify-center gap-x-2 text-muted-foreground">
              <CircleXIcon className="size-4 shrink-0" />
              No logs found
            </div>
          )}
        </LogScrollArea>
        <footer className="flex justify-end">
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

function DeploymentStatus({
  status,
}: {
  status: DeploymentContext['deployment']['status']
}) {
  if (status === 'succeeded') {
    return (
      <span className="flex items-center gap-2 text-green-500">
        <CircleCheckIcon className="size-4 shrink-0" />
        Succeeded
      </span>
    )
  }

  if (status === 'failed') {
    return (
      <span className="flex items-center gap-2 text-red-500">
        <CircleXIcon className="size-4 shrink-0" />
        Failed
      </span>
    )
  }

  if (status === 'canceled') {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <XIcon className="size-4 shrink-0" />
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
  status: DeploymentContext['deployment']['status']
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

function getDeploymentAlias(context: DeploymentContext) {
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

function getDeploymentFallbackMessage(
  deployment: DeploymentContext['deployment'],
) {
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
