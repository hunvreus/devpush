import { Link } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ServerAvailabilityAlert } from '@/features/servers/server-availability-alert'
import { getServerAvailabilityNotice } from '@/features/servers/server-availability'
import { TeamPage } from '@/features/teams/team-header'
import type { ProjectContext } from '@/server/projects/types'

type ProjectLayoutContext = Pick<
  ProjectContext,
  'team' | 'project' | 'environment' | 'environments' | 'servers'
>

type ProjectPageContext = ProjectLayoutContext &
  Pick<ProjectContext, 'teamProjects' | 'userContext'>

export function ProjectPage({
  children,
  context,
}: {
  children: ReactNode
  context: ProjectPageContext
}) {
  return (
    <TeamPage
      contentClassName="space-y-8"
      currentProject={context.project}
      currentProjects={context.teamProjects}
      currentTeam={context.team}
      servers={context.servers}
      userContext={context.userContext}
    >
      <ProjectLayout context={context} contentClassName="space-y-8">
        {children}
      </ProjectLayout>
    </TeamPage>
  )
}

function ProjectLayout({
  children,
  contentClassName,
  context,
}: {
  children: ReactNode
  contentClassName?: string
  context: ProjectLayoutContext
}) {
  const serverBlockReason = getServerBlockReason(context)
  const missingComposeFile = context.project.runtimeConfig.path === null

  return (
    <div className={contentClassName}>
      {missingComposeFile ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>No Compose file configured</AlertTitle>
          <AlertDescription>
            devpush did not find compose.yml, compose.yaml, docker-compose.yml,
            or docker-compose.yaml at the repository root. Set the Compose file
            path before deploying this project.
          </AlertDescription>
          <AlertAction>
            <Button asChild size="sm" variant="outline">
              <Link
                to="/$teamSlug/projects/$projectName/settings"
                hash="build-and-deploy"
                params={{
                  teamSlug: context.team.slug,
                  projectName: context.project.name,
                }}
              >
                View
              </Link>
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {serverBlockReason?.targetServerId ? (
        <ServerAvailabilityAlert
          notice={serverBlockReason}
          team={context.team}
        />
      ) : serverBlockReason ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>{serverBlockReason.title}</AlertTitle>
          <AlertDescription>{serverBlockReason.description}</AlertDescription>
          <AlertAction>
            <Button asChild size="sm" variant="outline">
              <Link
                to="/$teamSlug/projects/$projectName/settings"
                hash="servers"
                params={{
                  teamSlug: context.team.slug,
                  projectName: context.project.name,
                }}
              >
                View
              </Link>
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {children}
    </div>
  )
}

function getServerBlockReason(context: ProjectLayoutContext) {
  const configuredEnvironments = context.environments.filter(
    (environment) => environment.status === 'active',
  )

  if (
    configuredEnvironments.every(
      (environment) => !environment.effectiveServerId,
    )
  ) {
    return {
      targetServerId: null,
      title: 'No server assigned',
      description: 'Assign a server before deploying this project.',
    }
  }

  const assignedServerIds = Array.from(
    new Set(
      configuredEnvironments
        .map((environment) => environment.effectiveServerId)
        .filter(Boolean),
    ),
  )
  const assignedServers = assignedServerIds.map((serverId) => ({
    assignmentId: serverId,
    server: context.servers.find((server) => server.id === serverId),
  }))
  const missingServers = assignedServers.filter((item) => !item.server)
  const existingAssignedServers = assignedServers.flatMap((item) =>
    item.server ? [item.server] : [],
  )
  const unavailableServers = existingAssignedServers.filter(
    (server) => server.status !== 'connected',
  )

  if (missingServers.length > 0) {
    return {
      targetServerId: null,
      title: 'Project server missing',
      description:
        'One or more assigned servers no longer exist. Choose another server before deploying this project.',
    }
  }

  const unavailable = unavailableServers.at(0)
  if (unavailable) {
    if (
      unavailableServers.every((server) => server.status === 'disconnected')
    ) {
      return getServerAvailabilityNotice(unavailableServers)
    }
    return {
      targetServerId: unavailable.id,
      title:
        unavailableServers.length === 1
          ? 'Project server unavailable'
          : 'Project servers unavailable',
      description: `${formatServerList(unavailableServers)} ${unavailableServers.length === 1 ? 'is' : 'are'} not connected.`,
    }
  }

  return null
}

function formatServerList(servers: Array<{ name: string }>) {
  return new Intl.ListFormat('en', {
    style: 'long',
    type: 'conjunction',
  }).format(servers.map((server) => server.name))
}
