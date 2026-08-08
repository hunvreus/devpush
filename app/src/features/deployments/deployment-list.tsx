import { Link, useParams, useRouter } from '@tanstack/react-router'
import {
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
import { useEffect } from 'react'

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
import type { DeploymentSummary } from '@/server/projects/service'

export function DeploymentList({
  deployments,
  displayProject = false,
  limit,
}: {
  deployments: Array<DeploymentSummary>
  displayProject?: boolean
  limit?: number
}) {
  const params = useParams({ strict: false })
  const router = useRouter()
  const teamSlug =
    typeof params.teamSlug === 'string' ? params.teamSlug : 'ronan-berder'
  const rows = limit ? deployments.slice(0, limit) : deployments
  const deploymentAliases = getDeploymentAliases(deployments)
  const shouldRefresh = deployments.some(
    (deployment) =>
      deployment.status === 'queued' || deployment.status === 'running',
  )

  useEffect(() => {
    if (!shouldRefresh) {
      return
    }

    const interval = window.setInterval(() => {
      void router.invalidate()
    }, 2000)

    return () => window.clearInterval(interval)
  }, [router, shouldRefresh])

  return (
    <ul>
      {rows.map((deployment) => (
        <DeploymentRow
          key={deployment.id}
          deployment={deployment}
          displayProject={displayProject}
          alias={deploymentAliases.get(deployment.id)}
          teamSlug={teamSlug}
        />
      ))}
    </ul>
  )
}

function DeploymentRow({
  alias,
  deployment,
  displayProject,
  teamSlug,
}: {
  alias?: 'current' | 'previous'
  deployment: DeploymentSummary
  displayProject: boolean
  teamSlug: string
}) {
  const hasGitSha = deployment.gitSha !== 'pending'
  const visitUrl =
    deployment.defaultHost && deployment.status === 'succeeded'
      ? routeUrl({
          host: deployment.defaultHost,
          https: deployment.defaultRouteHttps,
        })
      : null

  return (
    <li className="flex h-12 items-center gap-4 border border-b-0 px-4 text-sm first:rounded-t-xl last:rounded-b-xl last:border-b hover:bg-muted/50">
      <DeploymentStatusIcon status={deployment.status} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/$teamSlug/projects/$projectName/deployments/$deploymentId"
            params={{
              teamSlug,
              projectName: deployment.projectName,
              deploymentId: deployment.id,
            }}
          >
            <span className="font-mono text-[13px] font-medium">
              {shortDeploymentId(deployment.id)}
            </span>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Deployment ID</TooltipContent>
      </Tooltip>

      {displayProject ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/$teamSlug/projects/$projectName"
              params={{ teamSlug, projectName: deployment.projectName }}
              className="flex min-w-0 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ResourceAvatar
                name={deployment.projectName}
                color={deployment.projectColor}
                size="xs"
              />
              <span className="truncate">{deployment.projectName}</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent>Project</TooltipContent>
        </Tooltip>
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/$teamSlug/projects/$projectName/deployments"
            params={{
              teamSlug,
              projectName: deployment.projectName,
            }}
            search={{ environment: deployment.environmentSlug }}
            className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <EnvironmentDot color={deployment.environmentColor} />
            {deployment.environmentName}
          </Link>
        </TooltipTrigger>
        <TooltipContent>Environment</TooltipContent>
      </Tooltip>

      <span className="whitespace-nowrap text-muted-foreground">
        {formatAge(deployment.createdAt)}
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={`https://github.com/${deployment.githubRepo}/tree/${deployment.gitBranch}`}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
          >
            <GitBranchIcon />
            <span className="truncate">{deployment.gitBranch}</span>
          </a>
        </TooltipTrigger>
        <TooltipContent>Branch</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          {hasGitSha ? (
            <a
              href={`https://github.com/${deployment.githubRepo}/commit/${deployment.gitSha}`}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 max-w-1/2 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
            >
              <GitCommitHorizontalIcon />
              <span className="truncate">
                {deployment.commitMessage ??
                  getDeploymentFallbackMessage(deployment)}
              </span>
            </a>
          ) : (
            <span className="flex min-w-0 max-w-1/2 items-center gap-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
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

      {alias === 'current' ? (
        <span className="inline-flex h-5 items-center gap-x-1 rounded-md bg-secondary px-2 text-xs font-medium text-secondary-foreground max-sm:hidden">
          <SparkleIcon className="size-3 shrink-0" />
          Current
        </span>
      ) : alias === 'previous' ? (
        <span className="inline-flex h-5 items-center rounded-md bg-secondary px-2 text-xs font-medium text-muted-foreground max-sm:hidden">
          Previous
        </span>
      ) : null}

      <div className="ml-auto flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              asChild={visitUrl !== null}
              disabled={visitUrl === null}
            >
              {visitUrl ? (
                <a
                  href={visitUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Visit"
                >
                  <Link2Icon />
                </a>
              ) : (
                <Link2Icon />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Visit</TooltipContent>
        </Tooltip>
        {!displayProject ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Deployment options"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DeploymentActions deployment={deployment} teamSlug={teamSlug} />
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  )
}

function DeploymentStatusIcon({
  status,
}: {
  status: DeploymentSummary['status']
}) {
  if (status === 'succeeded') {
    return <CircleCheckIcon className="size-4 shrink-0 text-green-500" />
  }

  if (status === 'failed') {
    return <CircleXIcon className="size-4 shrink-0 text-red-500" />
  }

  if (status === 'canceled') {
    return <XIcon className="size-4 shrink-0 text-muted-foreground" />
  }

  if (status === 'queued') {
    return <Clock3Icon className="size-4 shrink-0 text-muted-foreground" />
  }

  return (
    <LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
  )
}

function shortDeploymentId(id: string) {
  return id.slice(0, 7)
}

function getDeploymentFallbackMessage(deployment: DeploymentSummary) {
  if (deployment.errorMessage) {
    return deployment.errorMessage
  }

  if (deployment.trigger === 'user') {
    return 'Manual deploy'
  }

  return 'Deployment'
}

function getDeploymentAliases(deployments: Array<DeploymentSummary>) {
  const aliases = new Map<string, 'current' | 'previous'>()
  const succeededByTarget = new Map<string, Array<DeploymentSummary>>()

  for (const deployment of deployments) {
    if (deployment.status !== 'succeeded') {
      continue
    }

    const target = `${deployment.projectName}:${deployment.environmentName}`
    const entries = succeededByTarget.get(target) ?? []
    entries.push(deployment)
    succeededByTarget.set(target, entries)
  }

  for (const entries of succeededByTarget.values()) {
    entries.sort(
      (first, second) =>
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime(),
    )

    if (entries[0]) {
      aliases.set(entries[0].id, 'current')
    }

    if (entries[1]) {
      aliases.set(entries[1].id, 'previous')
    }
  }

  return aliases
}

function formatAge(value: string) {
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
