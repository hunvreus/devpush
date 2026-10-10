import type { QueryClient } from '@tanstack/react-query'

const resourceFamilies = new Set([
  'team-context',
  'server-context',
  'repository-selection',
  'project-context',
  'project-logs',
  'deployment-context',
  'deployment-logs',
])

// Mutation responses and navigation must not reuse pre-write snapshots. Mark
// inactive entries too; the next route loader fetches invalidated data on demand.
export async function invalidateResourceQueries(
  queryClient: QueryClient,
  teamSlug?: string,
) {
  const filters = {
    predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
      resourceFamilies.has(String(queryKey[0])) &&
      (teamSlug === undefined || queryKey[1] === teamSlug),
  }
  await queryClient.cancelQueries(filters)
  await queryClient.invalidateQueries({ ...filters, refetchType: 'none' })
}
