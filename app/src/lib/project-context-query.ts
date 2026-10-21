import { workspacePollInterval } from './workspace-updates'
import { invalidateResourceQueries } from './resource-cache'
import { queryOptions } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

import {
  getDeployment,
  getProject,
  getProjectLogs,
  getProjectSection,
} from '@/server/projects/functions'
import type {
  DeploymentContext,
  ProjectContext,
  ProjectLogsContext,
  ProjectSectionContext,
} from '@/server/projects/types'

export type ProjectContextKeyParams = {
  projectName: string
  teamSlug: string
}

export type ProjectContextParams = ProjectContextKeyParams & {
  scope: ProjectSectionContext['scope']
}

function projectContextQueryKey({
  projectName,
  scope,
  teamSlug,
}: ProjectContextParams) {
  return ['project-context', teamSlug, projectName, scope] as const
}

export function projectContextQueryOptions(
  params: ProjectContextParams,
  queryClient: QueryClient,
) {
  return queryOptions({
    queryKey: projectContextQueryKey(params),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: ['overview', 'deployments', 'backups'].includes(
      params.scope,
    ),
    refetchInterval: (query) => {
      if (!['overview', 'deployments', 'backups'].includes(params.scope))
        return false
      if (
        query.state.data?.deployments.some((deployment) =>
          ['queued', 'running'].includes(deployment.status),
        ) ||
        (params.scope === 'backups' &&
          (query.state.data?.backupRuns.some((run) =>
            ['queued', 'running'].includes(run.status),
          ) ||
            query.state.data?.backupRestores.some((restore) =>
              ['queued', 'running'].includes(restore.status),
            )))
      )
        return workspacePollInterval(params.teamSlug, 2_000)
      return workspacePollInterval(params.teamSlug, 15_000)
    },
    queryFn: async () => {
      const [shell, section] = await loadProjectSection(
        queryClient,
        params,
        () => getProjectSection({ data: params }),
      )

      return mergeProjectSection(shell, section)
    },
  })
}

export function projectShellQueryOptions(params: ProjectContextKeyParams) {
  return queryOptions({
    queryKey: ['project-context', params.teamSlug, params.projectName, 'shell'],
    queryFn: () => fetchProjectContext(params),
  })
}

export function deploymentContextQueryOptions(
  params: ProjectContextKeyParams & { deploymentId: string },
  queryClient: QueryClient,
) {
  return queryOptions({
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      ['queued', 'running'].includes(query.state.data?.deployment.status ?? '')
        ? workspacePollInterval(params.teamSlug, 2_000)
        : workspacePollInterval(params.teamSlug, 15_000),
    queryKey: [
      'deployment-context',
      params.teamSlug,
      params.projectName,
      params.deploymentId,
    ],
    queryFn: async (): Promise<DeploymentContext> => {
      const [shell, section] = await loadProjectSection(
        queryClient,
        params,
        () => getDeployment({ data: params }),
      )

      return {
        userContext: shell.userContext,
        team: shell.team,
        project: shell.project,
        teamProjects: shell.teamProjects,
        latestDeployments: section.latestDeployments,
        environment: shell.environment,
        environments: shell.environments,
        servers: shell.servers,
        deployment: section.deployment,
        logs: [],
      }
    },
  })
}

export type ProjectLogsQueryParams = ProjectContextKeyParams & {
  branch?: string | null
  date?: string | null
  deploymentId?: string | null
  environmentId?: string | null
  keyword?: string | null
}

export function projectLogsQueryOptions(
  params: ProjectLogsQueryParams,
  queryClient: QueryClient,
) {
  return queryOptions({
    refetchIntervalInBackground: false,
    refetchInterval: () => workspacePollInterval(params.teamSlug, 2_000),
    queryKey: [
      'project-logs',
      params.teamSlug,
      params.projectName,
      params.branch ?? null,
      params.date ?? null,
      params.deploymentId ?? null,
      params.environmentId ?? null,
      params.keyword ?? null,
    ],
    queryFn: async (): Promise<ProjectLogsContext> => {
      const [shell, section] = await loadProjectSection(
        queryClient,
        params,
        () => getProjectLogs({ data: params }),
      )

      return { ...shell, ...section }
    },
  })
}

export function invalidateProjectLogs(
  queryClient: QueryClient,
  params: ProjectLogsQueryParams,
) {
  return queryClient.invalidateQueries({
    queryKey: [
      'project-logs',
      params.teamSlug,
      params.projectName,
      params.branch ?? null,
      params.date ?? null,
      params.deploymentId ?? null,
      params.environmentId ?? null,
      params.keyword ?? null,
    ],
  })
}

export async function setProjectContextQueryData(
  queryClient: QueryClient,
  context: ProjectContext,
  scope: ProjectSectionContext['scope'],
) {
  await invalidateResourceQueries(queryClient, context.team.slug)
  const prefix = ['project-context', context.team.slug, context.project.name]

  queryClient.setQueryData([...prefix, 'shell'], context)
  queryClient.setQueryData([...prefix, scope], context)
}

export function invalidateProjectContext(
  queryClient: QueryClient,
  params: ProjectContextKeyParams,
) {
  return queryClient.invalidateQueries({
    queryKey: ['project-context', params.teamSlug, params.projectName],
  })
}

async function fetchProjectContext(
  params: ProjectContextKeyParams,
): Promise<ProjectContext> {
  const context = await getProject({ data: params })

  if (!context) {
    throw redirect({ to: '/auth/login' })
  }

  return context
}

async function loadProjectSection<T extends { projectId: string }>(
  queryClient: QueryClient,
  params: ProjectContextKeyParams,
  loadSection: () => Promise<T | null>,
): Promise<[ProjectContext, T]> {
  const [shell, section] = await Promise.all([
    queryClient.fetchQuery(projectShellQueryOptions(params)),
    loadSection(),
  ])

  if (!section) throw redirect({ to: '/auth/login' })
  if (section.projectId !== shell.project.id) {
    throw new Error('Project context changed while loading.')
  }

  return [shell, section]
}

function mergeProjectSection(
  shell: ProjectContext,
  section: ProjectSectionContext,
): ProjectContext {
  if (section.scope === 'overview') {
    return {
      ...shell,
      deployments: section.deployments,
      environment: { ...shell.environment, runtime: section.runtime },
    }
  }

  if (section.scope === 'deployments') {
    return { ...shell, deployments: section.deployments }
  }

  if (section.scope === 'settings') return section.context

  return {
    ...shell,
    backupStorage: section.backupStorage,
    backupConfigs: section.backupConfigs,
    backupRuns: section.backupRuns,
    backupRestores: section.backupRestores,
    composeMetadata: section.composeMetadata,
  }
}
