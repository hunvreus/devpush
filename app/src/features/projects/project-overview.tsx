import { Link } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  BoxesIcon,
  CloudUploadIcon,
  GitBranchIcon,
  Link2Icon,
  SettingsIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { ProjectHeading } from './project-heading'
import {
  DeploymentList,
  DeploymentListPending,
} from '@/features/deployments/deployment-list'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import { ManualDeployDialog } from '@/features/projects/manual-deploy-dialog'
import { formatAge } from '@/features/servers/team-servers'
import {
  getDeployBlockReason,
  hasActiveDeployment,
} from '@/features/projects/deploy-readiness'
import { routeUrl } from '@/lib/urls'
import type { ProjectContext } from '@/server/projects/types'

export function ProjectOverview({
  context,
  deploymentsPending = false,
}: {
  context: ProjectContext
  deploymentsPending?: boolean
}) {
  const teamSlug = context.team.slug
  const { project, environment, deployments } = context
  const deployBlockReason = getDeployBlockReason(environment)
  const hasActiveDeploy = hasActiveDeployment(deployments)

  return (
    <>
      <ProjectHeading teamSlug={teamSlug} project={project} />

      <section className="space-y-4">
        <header className="flex h-8 items-center justify-between gap-x-4">
          <h2 className="text-base font-medium">Environments</h2>
          <Button asChild>
            <Link
              to="/$teamSlug/projects/$projectName/settings"
              hash="environments"
              params={{ teamSlug, projectName: project.name }}
            >
              <SettingsIcon data-icon="inline-start" />
              Manage environments
            </Link>
          </Button>
        </header>
        <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <li className="rounded-xl border bg-card p-4 text-sm text-card-foreground">
            <header className="mb-4 flex items-center gap-x-2 truncate">
              <Link
                to="/$teamSlug/projects/$projectName/deployments"
                params={{ teamSlug, projectName: project.name }}
                search={{ environment: environment.slug }}
                className="flex h-4 min-w-0 items-center gap-x-2 truncate"
              >
                <span className="flex size-4 items-center justify-center">
                  <EnvironmentDot color={environment.color} />
                </span>
                <span className="flex-1 truncate font-medium">
                  {environment.name}
                </span>
              </Link>
            </header>
            <ul className="space-y-1 text-sm">
              <li>
                {environment.defaultHost ? (
                  <a
                    href={routeUrl({
                      host: environment.defaultHost,
                      https: environment.publicRoutes.at(0)?.https ?? true,
                    })}
                    className="flex min-w-0 items-center gap-x-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
                    target="_blank"
                    rel="noreferrer"
                    title="Visit"
                  >
                    <Link2Icon />
                    <span className="truncate">{environment.defaultHost}</span>
                  </a>
                ) : (
                  <span className="flex min-w-0 items-center gap-x-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
                    <Link2Icon />
                    <span className="truncate">No route configured</span>
                  </span>
                )}
              </li>
              <li>
                <span
                  className="flex w-min min-w-0 items-center gap-x-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
                  title="Branch"
                >
                  <GitBranchIcon />
                  <span className="truncate">{environment.branch}</span>
                </span>
              </li>
            </ul>
          </li>
        </ul>
      </section>

      {environment.runtime ? (
        <section className="space-y-4">
          <header>
            <h2 className="text-base font-medium">Runtime services</h2>
            <p className="text-sm text-muted-foreground">
              Latest Compose state reported{' '}
              {formatAge(environment.runtime.observedAt)}.
            </p>
          </header>
          <ul className="divide-y rounded-xl border bg-card text-sm text-card-foreground">
            {environment.runtime.services.length > 0 ? (
              environment.runtime.services.map((service) => {
                const status = getRuntimeServiceStatus(service)
                return (
                  <li
                    key={service.containerName}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <BoxesIcon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{service.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {service.containerName}
                          {service.restartCount > 0
                            ? ` · ${service.restartCount} restarts`
                            : ''}
                        </p>
                      </div>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </li>
                )
              })
            ) : (
              <li className="px-4 py-6 text-center text-muted-foreground">
                No Compose services reported.
              </li>
            )}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4">
        <header className="flex h-8 items-center justify-between gap-x-4">
          <h2 className="text-base font-medium">Latest deployments</h2>
          {deployments.length > 0 ? (
            <ManualDeployDialog
              teamSlug={teamSlug}
              projectName={project.name}
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
        </header>
        {deploymentsPending ? (
          <DeploymentListPending label="Latest deployments loading" />
        ) : deployments.length > 0 ? (
          <div className="space-y-4">
            <DeploymentList
              deployments={deployments}
              limit={4}
              teamSlug={teamSlug}
            />
            <footer className="flex justify-end">
              <Button variant="outline" asChild>
                <Link
                  to="/$teamSlug/projects/$projectName/deployments"
                  params={{ teamSlug, projectName: project.name }}
                >
                  All deployments
                  <ArrowRightIcon data-icon="inline-end" />
                </Link>
              </Button>
            </footer>
          </div>
        ) : (
          <Empty className="min-h-60 border bg-card text-card-foreground">
            <EmptyHeader>
              <EmptyTitle>No deployments yet.</EmptyTitle>
              <EmptyDescription>
                Push code to your repository or trigger a deployment below.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <ManualDeployDialog
                teamSlug={teamSlug}
                projectName={project.name}
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

function getRuntimeServiceStatus(
  service: NonNullable<
    ProjectContext['environment']['runtime']
  >['services'][number],
): {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
} {
  if (service.state !== 'running') {
    return {
      label:
        service.state === 'exited'
          ? `Exited (${service.exitCode})`
          : service.state,
      variant: 'destructive',
    }
  }
  if (service.health === 'unhealthy') {
    return { label: 'Unhealthy', variant: 'destructive' }
  }
  if (service.health === 'starting') {
    return { label: 'Starting', variant: 'secondary' }
  }
  return {
    label: service.health === 'healthy' ? 'Healthy' : 'Running',
    variant: service.health === 'healthy' ? 'default' : 'outline',
  }
}
