import { Link, useParams, useRouter } from '@tanstack/react-router'
import {
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  CloudUploadIcon,
  LoaderIcon,
} from 'lucide-react'

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
import { ResourceAvatar } from '@/components/resource-avatar'
import type { ProjectContext } from '@/server/projects/service'
import { filterDeployments } from './deployment-filters'
import type { DeploymentsSearch } from './deployment-filters'

export function DeploymentsPage({
  context,
  filters,
}: {
  context: ProjectContext
  filters: DeploymentsSearch
}) {
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/deployments',
  })
  const deployBlockReason = getDeployBlockReason(context.environment)
  const hasActiveDeploy = hasActiveDeployment(context.deployments)
  const filteredDeployments = filterDeployments(context.deployments, filters)

  return (
    <>
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
              <CloudUploadIcon data-icon="inline-start" />
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
                  disabled={Boolean(deployBlockReason)}
                  title={deployBlockReason ?? undefined}
                >
                  <CloudUploadIcon data-icon="inline-start" />
                  Deploy
                </Button>
              </ManualDeployDialog>
            </EmptyContent>
          </Empty>
        )}
      </section>
    </>
  )
}

function DeploymentFilters({
  context,
  filters,
}: {
  context: ProjectContext
  filters: DeploymentsSearch
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
  const environments = context.environments.map((environment) => ({
    slug: environment.slug,
    name: environment.name,
    color: environment.color,
  }))
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
      : (environments.find(
          (environment) => environment.slug === activeFilters.environment,
        )?.name ?? 'All environments')
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
        <SelectTrigger>
          <SelectValue>
            <EnvironmentFilterLabel
              color={
                environments.find(
                  (environment) =>
                    environment.slug === activeFilters.environment,
                )?.color
              }
              label={selectedEnvironmentLabel}
            />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All environments</SelectItem>
          {environments.map((environment) => (
            <SelectItem value={environment.slug} key={environment.slug}>
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
        <SelectTrigger>
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
        value={activeFilters.branch}
        onValueChange={(value) => updateFilter('branch', value)}
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
        <Button variant="ghost" onClick={resetFilters}>
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
      <CircleCheckIcon
        className="size-4 shrink-0 text-green-500"
        data-preserve-color
      />
    )
  }

  if (status === 'failed') {
    return (
      <CircleXIcon
        className="size-4 shrink-0 text-red-500"
        data-preserve-color
      />
    )
  }

  if (status === 'canceled') {
    return (
      <CircleXIcon
        className="size-4 shrink-0 text-amber-500"
        data-preserve-color
      />
    )
  }

  if (status === 'queued') {
    return (
      <Clock3Icon
        className="size-4 shrink-0 text-muted-foreground"
        data-preserve-color
      />
    )
  }

  if (status === 'running') {
    return (
      <LoaderIcon
        className="size-4 shrink-0 animate-spin text-muted-foreground"
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
