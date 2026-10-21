import { queryOptions } from '@tanstack/react-query'
import { getProjectDeployOptions } from '@/server/projects/functions'

export function manualDeployOptionsQueryOptions(params: {
  teamSlug: string
  projectName: string
  branch?: string
  environmentId: string
}) {
  return queryOptions({
    queryKey: [
      'manual-deploy-options',
      params.teamSlug,
      params.projectName,
      params.environmentId,
      params.branch ?? null,
    ],
    staleTime: 30_000,
    queryFn: ({ signal }) => getProjectDeployOptions({ data: params, signal }),
  })
}
