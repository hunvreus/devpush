import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  CloudUploadIcon,
  GitBranchIcon,
  Link2Icon,
  SettingsIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { ResourceAvatar } from '@/components/resource-avatar'
import { DeploymentList } from '@/features/deployments/deployment-list'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import { ManualDeployDialog } from '@/features/projects/manual-deploy-dialog'
import {
  getDeployBlockReason,
  hasActiveDeployment,
} from '@/features/projects/deploy-readiness'
import { routeUrl } from '@/lib/urls'
import type { ProjectContext } from '@/server/projects/service'

export function ProjectOverview({ context }: { context: ProjectContext }) {
  const params = useParams({ strict: false })
  const teamSlug =
    typeof params.teamSlug === 'string' ? params.teamSlug : 'ronan-berder'
  const { project, environment, deployments } = context
  const deployBlockReason = getDeployBlockReason(environment)
  const hasActiveDeploy = hasActiveDeployment(deployments)

  return (
    <>
      <section>
        <h1 className="flex items-center gap-x-3 text-2xl font-medium">
          <ResourceAvatar name={project.name} color={project.color} size="md" />
          {project.name}
        </h1>
      </section>

      <section className="space-y-4">
        <header className="flex h-8 items-center justify-between gap-x-4">
          <h2 className="text-base font-medium">Environments</h2>
          <Button size="sm" asChild>
            <Link
              to="/$teamSlug/projects/$projectName/settings"
              hash="environments"
              params={{ teamSlug, projectName: project.name }}
            >
              <SettingsIcon />
              Manage environments
            </Link>
          </Button>
        </header>
        <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <li className="rounded-xl border bg-card p-4 text-sm text-card-foreground shadow-sm">
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
                size="sm"
              >
                <CloudUploadIcon />
                Deploy
              </Button>
            </ManualDeployDialog>
          ) : null}
        </header>
        {deployments.length > 0 ? (
          <div className="space-y-4">
            <DeploymentList deployments={deployments} limit={4} />
            <footer className="flex justify-end">
              <Button variant="outline" size="sm" asChild>
                <Link
                  to="/$teamSlug/projects/$projectName/deployments"
                  params={{ teamSlug, projectName: project.name }}
                >
                  All deployments
                  <ArrowRightIcon />
                </Link>
              </Button>
            </footer>
          </div>
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
                teamSlug={teamSlug}
                projectName={project.name}
                environments={context.environments}
                hasActiveDeployment={hasActiveDeploy}
                disabled={Boolean(deployBlockReason)}
              >
                <Button
                  disabled={Boolean(deployBlockReason)}
                  title={deployBlockReason ?? undefined}
                  size="sm"
                >
                  <CloudUploadIcon />
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
