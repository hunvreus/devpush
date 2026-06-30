import {
  Outlet,
  Link,
  createFileRoute,
  redirect,
  useParams,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import {
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  CloudUploadIcon,
  LoaderIcon,
} from 'lucide-react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DeploymentList } from '@/features/deployments/deployment-list'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import { ManualDeployDialog } from '@/features/projects/manual-deploy-dialog'
import {
  getDeployBlockReason,
  hasActiveDeployment,
} from '@/features/projects/deploy-readiness'
import { ProjectLayout } from '@/features/projects/project-layout'
import { ResourceAvatar } from '@/components/resource-avatar'
import { getProject } from '@/server/projects/functions'
import type { ProjectContext } from '@/server/projects/service'

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/deployments',
)({
  validateSearch: z.object({
    branch: z.string().optional().catch(undefined),
    date: z.string().optional().catch(undefined),
    environment: z.string().optional().catch(undefined),
    status: z.string().optional().catch(undefined),
  }),
  loader: async ({ params }) => {
    const context = await getProject({
      data: {
        teamSlug: params.teamSlug,
        projectName: params.projectName,
      },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  component: DeploymentsRoute,
})

function DeploymentsRoute() {
  const context = Route.useLoaderData()
  const filters = Route.useSearch()
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/deployments',
  })
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const deployBlockReason = getDeployBlockReason(context.environment)
  const hasActiveDeploy = hasActiveDeployment(context.deployments)
  const filteredDeployments = filterDeployments(context.deployments, filters)

  if (
    pathname !==
    `/${params.teamSlug}/projects/${params.projectName}/deployments`
  ) {
    return <Outlet />
  }

  return (
    <ProjectLayout context={context} contentClassName="space-y-8">
      <section className="flex items-center justify-between gap-4">
        <h1 className="flex min-w-0 items-center gap-x-3 text-2xl font-medium">
          <Link
            to="/$teamSlug/projects/$projectName"
            params={{
              teamSlug: params.teamSlug,
              projectName: params.projectName,
            }}
            className="shrink-0"
          >
            <ResourceAvatar
              name={context.project.name}
              color={context.project.color}
              size="md"
            />
          </Link>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <span className="truncate">Deployments</span>
        </h1>
        {context.deployments.length > 0 ? (
          <ManualDeployDialog
            teamSlug={params.teamSlug}
            projectName={params.projectName}
            environments={context.environments}
            hasActiveDeployment={hasActiveDeploy}
            disabled={Boolean(deployBlockReason)}
          >
            <Button
              disabled={Boolean(deployBlockReason)}
              title={deployBlockReason ?? undefined}
            >
              <CloudUploadIcon />
              Deploy
            </Button>
          </ManualDeployDialog>
        ) : null}
      </section>
      <section className="space-y-4">
        <header>
          <DeploymentFilters context={context} filters={filters} />
        </header>
        {context.deployments.length > 0 ? (
          <DeploymentList deployments={filteredDeployments} />
        ) : (
          <Empty className="min-h-60 border bg-card text-card-foreground shadow-sm">
            <EmptyHeader>
              <EmptyTitle>No deployments yet.</EmptyTitle>
              <EmptyDescription>
                Push code to your repository or trigger a deployment below.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <ManualDeployDialog
                teamSlug={params.teamSlug}
                projectName={params.projectName}
                environments={context.environments}
                hasActiveDeployment={hasActiveDeploy}
                disabled={Boolean(deployBlockReason)}
              >
                <Button
                  size="sm"
                  disabled={Boolean(deployBlockReason)}
                  title={deployBlockReason ?? undefined}
                >
                  <CloudUploadIcon />
                  Deploy
                </Button>
              </ManualDeployDialog>
            </EmptyContent>
          </Empty>
        )}
      </section>
    </ProjectLayout>
  )
}

function DeploymentFilters({
  context,
  filters,
}: {
  context: ProjectContext
  filters: {
    branch?: string
    date?: string
    environment?: string
    status?: string
  }
}) {
  const router = useRouter()
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/deployments',
  })
  const activeFilters = {
    branch: filters.branch ?? 'all',
    date: filters.date ?? 'all',
    environment: filters.environment ?? 'all',
    status: filters.status ?? 'all',
  }
  const environments = Array.from(
    new Map(
      context.deployments.map((deployment) => [
        deployment.environmentSlug,
        {
          name: deployment.environmentName,
          color: deployment.environmentColor,
        },
      ]),
    ),
  )
  const branches = Array.from(
    new Set(
      context.deployments
        .map((deployment) => deployment.gitBranch)
        .filter(Boolean),
    ),
  )
  const hasFilters = Object.values(activeFilters).some(
    (value) => value !== 'all',
  )
  const selectedEnvironmentLabel =
    activeFilters.environment === 'all'
      ? 'All environments'
      : (environments.find(([slug]) => slug === activeFilters.environment)?.[1]
          .name ?? 'All environments')
  const selectedStatusLabel =
    activeFilters.status === 'all'
      ? 'All statuses'
      : formatStatus(activeFilters.status)
  const selectedDateLabel = formatDatePreset(activeFilters.date)
  const selectedBranchLabel =
    activeFilters.branch === 'all' ? 'All branches' : activeFilters.branch
  const updateFilter = (name: keyof typeof activeFilters, value: string) => {
    void router.navigate({
      to: '/$teamSlug/projects/$projectName/deployments',
      params,
      search: {
        ...filters,
        [name]: value === 'all' ? undefined : value,
      },
    })
  }
  const resetFilters = () => {
    void router.navigate({
      to: '/$teamSlug/projects/$projectName/deployments',
      params,
      search: {},
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={activeFilters.environment}
        onValueChange={(value) => updateFilter('environment', value)}
      >
        <SelectTrigger size="sm">
          <SelectValue>
            <EnvironmentFilterLabel
              color={
                environments.find(
                  ([slug]) => slug === activeFilters.environment,
                )?.[1].color
              }
              label={selectedEnvironmentLabel}
            />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All environments</SelectItem>
          {environments.map(([slug, environment]) => (
            <SelectItem value={slug} key={slug}>
              <EnvironmentFilterLabel
                color={environment.color}
                label={environment.name}
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={activeFilters.status}
        onValueChange={(value) => updateFilter('status', value)}
      >
        <SelectTrigger size="sm">
          <SelectValue>
            <StatusFilterLabel
              status={activeFilters.status}
              label={selectedStatusLabel}
            />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="succeeded">
            <StatusFilterLabel status="succeeded" label="Succeeded" />
          </SelectItem>
          <SelectItem value="failed">
            <StatusFilterLabel status="failed" label="Failed" />
          </SelectItem>
          <SelectItem value="canceled">
            <StatusFilterLabel status="canceled" label="Canceled" />
          </SelectItem>
          <SelectItem value="running">
            <StatusFilterLabel status="running" label="Running" />
          </SelectItem>
          <SelectItem value="queued">
            <StatusFilterLabel status="queued" label="Queued" />
          </SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={activeFilters.date}
        onValueChange={(value) => updateFilter('date', value)}
      >
        <SelectTrigger size="sm">
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
        value={activeFilters.branch}
        onValueChange={(value) => updateFilter('branch', value)}
      >
        <SelectTrigger size="sm">
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
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          Reset filters
        </Button>
      ) : null}
    </div>
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

function StatusFilterLabel({
  label,
  status,
}: {
  label: string
  status: string
}) {
  return (
    <span className="flex items-center gap-2">
      <StatusFilterIcon status={status} />
      {label}
    </span>
  )
}

function StatusFilterIcon({ status }: { status: string }) {
  if (status === 'succeeded') {
    return (
      <CircleCheckIcon className="size-4 text-green-500" data-preserve-color />
    )
  }

  if (status === 'failed') {
    return <CircleXIcon className="size-4 text-red-500" data-preserve-color />
  }

  if (status === 'canceled') {
    return <CircleXIcon className="size-4 text-amber-500" data-preserve-color />
  }

  if (status === 'queued') {
    return (
      <Clock3Icon
        className="size-4 text-muted-foreground"
        data-preserve-color
      />
    )
  }

  if (status === 'running') {
    return (
      <LoaderIcon
        className="size-4 animate-spin text-muted-foreground"
        data-preserve-color
      />
    )
  }

  return null
}

function formatStatus(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatDatePreset(value: string) {
  if (value === 'today') {
    return 'Today'
  }

  if (value === '24h') {
    return 'Last 24 hours'
  }

  if (value === '7d') {
    return 'Last 7 days'
  }

  if (value === '30d') {
    return 'Last 30 days'
  }

  return 'All dates'
}

function filterDeployments(
  deployments: ProjectContext['deployments'],
  filters: {
    branch?: string
    date?: string
    environment?: string
    status?: string
  },
) {
  return deployments.filter((deployment) => {
    if (
      filters.environment &&
      deployment.environmentSlug !== filters.environment
    ) {
      return false
    }

    if (filters.status && deployment.status !== filters.status) {
      return false
    }

    if (filters.branch && deployment.gitBranch !== filters.branch) {
      return false
    }

    if (
      filters.date &&
      !isWithinDatePreset(deployment.createdAt, filters.date)
    ) {
      return false
    }

    return true
  })
}

function isWithinDatePreset(value: string, preset: string) {
  const date = new Date(value)
  const now = new Date()

  if (preset === 'today') {
    return date >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }

  const hours =
    preset === '24h'
      ? 24
      : preset === '7d'
        ? 24 * 7
        : preset === '30d'
          ? 24 * 30
          : null

  if (hours == null) {
    return true
  }

  return date.getTime() >= now.getTime() - hours * 60 * 60 * 1000
}
