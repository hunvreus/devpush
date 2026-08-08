import { queryOptions } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

import { getProject } from '@/server/projects/functions'
import type { ProjectContext } from '@/server/projects/service'

export type ProjectContextParams = {
  projectName: string
  teamSlug: string
}

export function projectContextQueryKey({
  projectName,
  teamSlug,
}: ProjectContextParams) {
  return ['project-context', teamSlug, projectName] as const
}

export function projectContextQueryOptions(params: ProjectContextParams) {
  return queryOptions({
    queryKey: projectContextQueryKey(params),
    queryFn: () => fetchProjectContext(params),
  })
}

export function setProjectContextQueryData(
  queryClient: QueryClient,
  context: ProjectContext,
) {
  queryClient.setQueryData(
    projectContextQueryKey({
      teamSlug: context.team.slug,
      projectName: context.project.name,
    }),
    context,
  )
}

export function invalidateProjectContext(
  queryClient: QueryClient,
  params: ProjectContextParams,
) {
  return queryClient.invalidateQueries({
    queryKey: projectContextQueryKey(params),
  })
}

async function fetchProjectContext(
  params: ProjectContextParams,
): Promise<ProjectContext> {
  const context = await getProject({ data: params })

  if (!context) {
    throw redirect({ to: '/auth/login' })
  }

  return context
}
