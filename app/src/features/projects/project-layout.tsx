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
import { ProjectPage } from '@/features/teams/team-header'
import type {
  DeploymentSummary,
  ProjectContext,
} from '@/server/projects/service'

type ProjectLayoutContext = Pick<
  ProjectContext,
  | 'userContext'
  | 'team'
  | 'project'
  | 'teamProjects'
  | 'environment'
  | 'serverAssignments'
  | 'servers'
> & {
  deployment?: {
    id: string
    status: ProjectContext['deployments'][number]['status']
  }
  deployments?: Array<DeploymentSummary>
  latestDeployments?: Array<DeploymentSummary>
}

export function ProjectLayout({
  children,
  contentClassName,
  context,
}: {
  children: ReactNode
  contentClassName?: string
  context: ProjectLayoutContext
}) {
  const deployments = context.deployments ?? context.latestDeployments ?? []
  const serverBlockReason = getServerBlockReason(context)
  const missingComposeFile = context.project.composePath === null

  return (
    <ProjectPage
      userContext={context.userContext}
      currentTeam={context.team}
      currentProject={context.project}
      currentProjects={context.teamProjects}
      currentDeployment={context.deployment}
      currentDeployments={deployments}
      contentClassName={contentClassName}
    >
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
      {serverBlockReason ? (
        <Alert variant="destructive">
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
    </ProjectPage>
  )
}

function getServerBlockReason(context: ProjectLayoutContext) {
  if (context.serverAssignments.length === 0) {
    return {
      title: 'No server assigned',
      description: 'Assign a server before deploying this project.',
    }
  }

  const assignedServerIds = Array.from(
    new Set(
      context.serverAssignments
        .map((assignment) => assignment.serverId)
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
      title: 'Project server missing',
      description:
        'One or more assigned servers no longer exist. Choose another server before deploying this project.',
    }
  }

  if (unavailableServers.length > 0) {
    return {
      title:
        unavailableServers.length === 1
          ? 'Project server unavailable'
          : 'Project servers unavailable',
      description: `${formatServerList(unavailableServers)} ${unavailableServers.length === 1 ? 'is' : 'are'} not connected. Reconnect or choose another server before deploying this project.`,
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
