import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { DeploymentAliasBadge } from './deployment-alias-badge'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  LoaderIcon,
  EllipsisVerticalIcon,
  CircleAlertIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Skeleton } from '@/components/ui/skeleton'
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
import type { DeploymentSummary } from '@/server/projects/types'

export function DeploymentList({
  deployments,
  displayProject = false,
  limit,
  teamSlug,
}: {
  deployments: Array<DeploymentSummary>
  displayProject?: boolean
  limit?: number
  teamSlug: string
}) {
  const rows = limit ? deployments.slice(0, limit) : deployments
  const deploymentAliases = getDeploymentAliases(deployments)

  if (rows.length === 0) {
    return (
      <Empty className="min-h-60 border bg-card text-card-foreground">
        <EmptyHeader>
          <EmptyTitle>No deployments yet.</EmptyTitle>
          <EmptyDescription>
            Deploy a project to see its history here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul className="scrollbar overflow-x-auto rounded-xl border bg-card text-card-foreground">
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

export function DeploymentListPending({
  displayProject = false,
  label = 'Deployments loading',
  rows = 1,
}: {
  displayProject?: boolean
  label?: string
  rows?: number
}) {
  return (
    <ul
      className="scrollbar overflow-x-auto rounded-xl border bg-card text-card-foreground"
      aria-label={label}
      aria-busy="true"
    >
      {Array.from({ length: rows }, (_, index) => (
        <li
          className="flex h-11 min-w-[28rem] items-center gap-4 border-b px-4 text-sm whitespace-nowrap md:min-w-[48rem] last:border-b-0"
          key={index}
        >
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-14 shrink-0" />
          {displayProject ? (
            <span className="flex min-w-0 items-center gap-2">
              <Skeleton className="size-5 shrink-0 rounded-md" />
              <Skeleton className="h-4 w-32" />
            </span>
          ) : null}
          <span className="flex shrink-0 items-center gap-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </span>
          <Skeleton className="h-4 w-12 shrink-0" />
          <span className="hidden min-w-0 items-center gap-2 sm:flex">
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className="h-4 w-12" />
          </span>
          <span className="hidden min-w-0 max-w-64 items-center gap-2 md:flex">
            <Skeleton className="size-5 shrink-0" />
            <Skeleton className="h-4 w-32" />
          </span>
          <Skeleton className="h-5 w-16 shrink-0 max-sm:hidden" />
          <div className="ml-auto shrink-0">
            <ButtonGroup className="-mr-2" aria-label="Deployment actions">
              <Button variant="outline" size="sm" disabled>
                Visit
                <ArrowUpRightIcon
                  data-icon="inline-end"
                  className="opacity-50"
                />
              </Button>
              {!displayProject ? (
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled
                  aria-label="Deployment options"
                >
                  <EllipsisVerticalIcon />
                </Button>
              ) : null}
            </ButtonGroup>
          </div>
        </li>
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
    deployment.deploymentHost && deployment.status === 'succeeded'
      ? routeUrl({
          host: deployment.deploymentHost,
          https: deployment.deploymentRouteHttps,
        })
      : null

  return (
    <li className="flex h-11 min-w-[28rem] items-center gap-4 border-b px-4 text-sm whitespace-nowrap md:min-w-[48rem] last:border-b-0 hover:bg-muted/50">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            aria-label={deployment.status}
            className="inline-flex shrink-0"
          >
            <DeploymentStatusIcon status={deployment.status} />
          </span>
        </TooltipTrigger>
        <TooltipContent className="capitalize">
          {deployment.status}
        </TooltipContent>
      </Tooltip>
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
              className="flex min-w-20 max-w-40 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
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
            className="flex min-w-16 max-w-32 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <EnvironmentDot color={deployment.environmentColor} />
            <span className="truncate">{deployment.environmentName}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Environment</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <time
            dateTime={deployment.createdAt}
            className="shrink-0 whitespace-nowrap text-muted-foreground"
          >
            {formatAge(deployment.createdAt)}
          </time>
        </TooltipTrigger>
        <TooltipContent>
          {new Intl.DateTimeFormat('en', {
            dateStyle: 'medium',
            timeStyle: 'long',
            timeZone: 'UTC',
          }).format(new Date(deployment.createdAt))}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={`https://github.com/${deployment.githubRepo}/tree/${deployment.gitBranch}`}
            target="_blank"
            rel="noreferrer"
            className="hidden min-w-16 max-w-32 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground sm:flex [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
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
              className="hidden min-w-0 max-w-64 items-center gap-2 md:flex text-muted-foreground transition-colors hover:text-foreground [&>svg]:shrink-0 [&>svg]:opacity-50"
            >
              <GitCommitHorizontalIcon className="size-5 shrink-0" />
              <span className="truncate">
                {deployment.commitMessage ??
                  getDeploymentFallbackMessage(deployment)}
              </span>
            </a>
          ) : (
            <span className="hidden min-w-0 max-w-64 items-center gap-2 md:flex text-muted-foreground [&>svg]:shrink-0 [&>svg]:opacity-50">
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

      <DeploymentAliasBadge alias={alias} className="max-sm:hidden" />

      <div className="ml-auto shrink-0">
        <ButtonGroup className="-mr-2" aria-label="Deployment actions">
          <Button
            variant="outline"
            size="sm"
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
                Visit
                <ArrowUpRightIcon
                  data-icon="inline-end"
                  className="opacity-50"
                />
              </a>
            ) : (
              <>
                Visit
                <ArrowUpRightIcon
                  data-icon="inline-end"
                  className="opacity-50"
                />
              </>
            )}
          </Button>
          {!displayProject ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Deployment options"
                >
                  <EllipsisVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DeploymentActions deployment={deployment} teamSlug={teamSlug} />
            </DropdownMenu>
          ) : null}
        </ButtonGroup>
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
    return <CircleCheckIcon className="size-4 shrink-0 text-success" />
  }

  if (status === 'failed') {
    return <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
  }

  if (status === 'canceled') {
    return <CircleXIcon className="size-4 shrink-0 text-muted-foreground" />
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
