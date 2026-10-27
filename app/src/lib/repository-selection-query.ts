import { queryOptions } from '@tanstack/react-query'

import { getRepositorySelectionContext } from '#devpush/server/projects/functions'

export function repositorySelectionQueryOptions(teamSlug: string) {
  return queryOptions({
    queryKey: ['repository-selection', teamSlug],
    queryFn: () => getRepositorySelectionContext({ data: { teamSlug } }),
    staleTime: 30_000,
  })
}
