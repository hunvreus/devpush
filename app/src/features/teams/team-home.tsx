import { refreshView } from '@/lib/action-feedback'
import { Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { GithubIcon, Link2Icon, PlusIcon, SettingsIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  DeploymentList,
  DeploymentListPending,
} from '@/features/deployments/deployment-list'
import { NewProjectDialogLauncher } from '@/features/repositories/new-project-dialog-launcher'
import { ResourceAvatar } from '@/components/resource-avatar'
import { AddServerDialog } from '@/features/servers/team-servers'
import { routeUrl } from '@/lib/urls'
import { invalidateTeamContext } from '@/lib/team-context-query'
import { canManageTeamSettings } from '@/lib/team-role'
import type { DeploymentSummary } from '@/server/projects/types'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type {
  ProjectSummary,
  ServerSummary,
  TeamSummary,
} from '@/server/teams/types'
import { TeamHeading } from './team-heading'

export function TeamHome({
  team,
  deployments,
  deploymentsPending = false,
  projects,
  servers,
}: {
  team: TeamSummary
  deployments: Array<DeploymentSummary>
  deploymentsPending?: boolean
  projects: Array<ProjectSummary>
  servers: Array<ServerSummary>
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [addServerOpen, setAddServerOpen] = useState(false)
  const hasProjects = projects.length > 0
  const canManageServers = canManageTeamSettings(team.role)

  return (
    <>
      <TeamHeading team={team} />

      {hasProjects ? (
        <section className="space-y-4">
          <header className="flex h-8 items-center justify-between gap-4">
            <h2 className="text-base font-medium">Recent projects</h2>
            <NewProjectButton teamSlug={team.slug} />
          </header>
          <RecentProjects teamSlug={team.slug} projects={projects} />
        </section>
      ) : servers.length === 0 ? (
        <section>
          <EmptyServers
            canAddServer={canManageServers}
            onAddServer={() => setAddServerOpen(true)}
          />
        </section>
      ) : (
        <section>
          <EmptyProjects teamSlug={team.slug} />
        </section>
      )}

      {deploymentsPending ? (
        <section className="space-y-4">
          <header className="flex h-8 items-center">
            <h2 className="text-base font-medium">Latest deployments</h2>
          </header>
          <DeploymentListPending
            displayProject
            label="Latest deployments loading"
          />
        </section>
      ) : deployments.length > 0 ? (
        <section className="space-y-4">
          <header className="flex h-8 items-center">
            <h2 className="text-base font-medium">Latest deployments</h2>
          </header>
          <DeploymentList
            deployments={deployments}
            displayProject
            teamSlug={team.slug}
          />
        </section>
      ) : null}

      {canManageServers ? (
        <AddServerDialog
          open={addServerOpen}
          teamSlug={team.slug}
          onOpenChange={setAddServerOpen}
          onCreated={() => {
            void refreshView(
              () =>
                invalidateTeamContext(queryClient, team.slug).then(() =>
                  router.invalidate(),
                ),
              'teams-team-home-refresh',
            )
          }}
        />
      ) : null}
    </>
  )
}

export function TeamProjects({
  team,
  projects,
}: {
  team: TeamSummary
  projects: Array<ProjectSummary>
}) {
  return (
    <>
      <TeamHeading
        team={team}
        crumb={<span>Projects</span>}
        actions={
          projects.length > 0 ? <NewProjectButton teamSlug={team.slug} /> : null
        }
      />

      <section>
        {projects.length > 0 ? (
          <ProjectRows teamSlug={team.slug} projects={projects} />
        ) : (
          <EmptyProjects teamSlug={team.slug} />
        )}
      </section>
    </>
  )
}

function EmptyServers({
  canAddServer,
  onAddServer,
}: {
  canAddServer: boolean
  onAddServer: () => void
}) {
  return (
    <Empty className="min-h-60 border bg-card text-card-foreground">
      <EmptyHeader>
        <EmptyTitle>Connect your first server.</EmptyTitle>
        <EmptyDescription>
          Add a server before creating and deploying projects.
        </EmptyDescription>
      </EmptyHeader>
      {canAddServer ? (
        <EmptyContent>
          <Button type="button" onClick={onAddServer}>
            <PlusIcon data-icon="inline-start" />
            Add server
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

function RecentProjects({
  teamSlug,
  projects,
}: {
  teamSlug: string
  projects: Array<ProjectSummary>
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {projects.slice(0, 6).map((item) => (
        <li
          key={item.name}
          className="rounded-xl border bg-card p-4 text-sm text-card-foreground"
        >
          <article>
            <header className="mb-4 flex items-center gap-2">
              <Link
                to="/$teamSlug/projects/$projectName"
                params={{ teamSlug, projectName: item.name }}
                className="flex min-w-0 items-center gap-2.5"
              >
                <ResourceAvatar
                  name={item.name}
                  src={item.avatarUrl ?? undefined}
                  color={item.color}
                  size="xs"
                />
                <h3 className="truncate font-medium">{item.name}</h3>
              </Link>
            </header>
            <ul className="space-y-1">
              <li>
                {item.defaultHost ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        className="flex min-w-0 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
                        href={routeUrl({
                          host: item.defaultHost,
                          https: item.defaultRouteHttps,
                        })}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Link2Icon />
                        <span className="truncate">{item.defaultHost}</span>
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>Visit</TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="flex min-w-0 items-center gap-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
                    <Link2Icon />
                    <span className="truncate">No public route</span>
                  </span>
                )}
              </li>
              <li>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      className="flex min-w-0 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
                      href={`https://github.com/${item.githubRepo}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <GithubIcon />
                      <span className="truncate">{item.githubRepo}</span>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>Repository</TooltipContent>
                </Tooltip>
              </li>
            </ul>
          </article>
        </li>
      ))}
    </ul>
  )
}

function ProjectRows({
  teamSlug,
  projects,
}: {
  teamSlug: string
  projects: Array<ProjectSummary>
}) {
  return (
    <ul className="overflow-hidden rounded-xl border bg-card text-card-foreground">
      {projects.map((project) => (
        <li
          className="flex h-11 min-w-0 items-center gap-x-8 border-b px-4 text-sm last:border-b-0 hover:bg-muted/50"
          key={project.id}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/$teamSlug/projects/$projectName"
                params={{ teamSlug, projectName: project.name }}
                className="flex min-w-0 items-center gap-x-2 font-medium"
              >
                <ResourceAvatar
                  name={project.name}
                  src={project.avatarUrl ?? undefined}
                  color={project.color}
                  size="xs"
                />
                <span className="max-w-3xs truncate">{project.name}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent>Name</TooltipContent>
          </Tooltip>

          {project.defaultHost ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  className="flex min-w-0 items-center gap-x-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
                  href={routeUrl({
                    host: project.defaultHost,
                    https: project.defaultRouteHttps,
                  })}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Link2Icon />
                  <span className="truncate">{project.defaultHost}</span>
                </a>
              </TooltipTrigger>
              <TooltipContent>URL</TooltipContent>
            </Tooltip>
          ) : (
            <span className="flex min-w-0 items-center gap-x-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
              <Link2Icon />
              <span className="truncate">No public route</span>
            </span>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <a
                className="flex min-w-0 items-center gap-x-2 text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50"
                href={`https://github.com/${project.githubRepo}`}
                target="_blank"
                rel="noreferrer"
              >
                <GithubIcon />
                <span className="truncate">{project.githubRepo}</span>
              </a>
            </TooltipTrigger>
            <TooltipContent>GitHub</TooltipContent>
          </Tooltip>

          <div className="ml-auto flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon-sm">
                  <Link
                    to="/$teamSlug/projects/$projectName/settings"
                    params={{ teamSlug, projectName: project.name }}
                    aria-label="Settings"
                  >
                    <SettingsIcon />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </div>
        </li>
      ))}
    </ul>
  )
}

function EmptyProjects({ teamSlug }: { teamSlug: string }) {
  return (
    <Empty className="min-h-60 border bg-card text-card-foreground">
      <EmptyHeader>
        <EmptyTitle>Deploy your first project.</EmptyTitle>
        <EmptyDescription>
          Add a new project from an existing GitHub repository.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <NewProjectButton teamSlug={teamSlug} />
      </EmptyContent>
    </Empty>
  )
}

function NewProjectButton({
  size,
  teamSlug,
}: {
  size?: 'default' | 'sm'
  teamSlug: string
}) {
  return (
    <NewProjectDialogLauncher teamSlug={teamSlug}>
      {(open) => (
        <Button onClick={open} size={size} type="button">
          <PlusIcon data-icon="inline-start" />
          New project
        </Button>
      )}
    </NewProjectDialogLauncher>
  )
}
