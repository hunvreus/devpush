import { workspacePollInterval } from './workspace-updates'
import type { TeamSummary } from '@/server/teams/types'
import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import {
  getTeamSectionContext,
  getTeamShellContext,
} from '@/server/auth/context'
import type { TeamContextSection } from '@/server/auth/context'

export type { TeamContextSection } from '@/server/auth/context'
export type TeamShellContext = NonNullable<
  Awaited<ReturnType<typeof getTeamShellContext>>
>
export type TeamSectionContext = NonNullable<
  Awaited<ReturnType<typeof getTeamSectionContext>>
>

export function teamShellQueryOptions({ teamSlug }: { teamSlug: string }) {
  return queryOptions({
    queryKey: ['team-context', teamSlug, 'shell'],
    queryFn: async () => {
      const context = await getTeamShellContext({ data: { teamSlug } })

      if (!context) {
        throw redirect({ to: '/auth/login' })
      }

      return context
    },
  })
}

export function teamSectionQueryOptions({
  section,
  teamSlug,
}: {
  section: TeamContextSection
  teamSlug: string
}) {
  return queryOptions({
    queryKey: ['team-context', teamSlug, 'section', section],
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: ['servers', 'overview'].includes(section)
      ? 'always'
      : false,
    refetchInterval: (query) =>
      section === 'servers'
        ? workspacePollInterval(teamSlug, 5_000)
        : query.state.data?.section === 'overview' &&
            query.state.data.deployments.some((deployment) =>
              ['queued', 'running'].includes(deployment.status),
            )
          ? workspacePollInterval(teamSlug, 2_000)
          : section === 'overview'
            ? workspacePollInterval(teamSlug, 15_000)
            : false,
    queryFn: async () => {
      const context = await getTeamSectionContext({
        data: { section, teamSlug },
      })

      if (!context) {
        throw redirect({ to: '/auth/login' })
      }

      return context
    },
  })
}

export function invalidateTeamContext(
  queryClient: QueryClient,
  teamSlug?: string,
) {
  return queryClient.invalidateQueries({
    queryKey: teamSlug ? ['team-context', teamSlug] : ['team-context'],
  })
}

export function getCachedTeamContexts(
  queryClient: QueryClient,
  teamSlug: string,
) {
  return queryClient
    .getQueriesData<TeamShellContext>({
      queryKey: ['team-context', teamSlug, 'shell'],
    })
    .flatMap(([, context]) => (context ? [context] : []))
}

// Team metadata is embedded in navigation for both team and project pages.
// Preserve each snapshot's age: changing a name does not refresh its other data.
export async function setTeamContextQueryData(
  queryClient: QueryClient,
  team: TeamSummary,
) {
  const filters = {
    predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
      (queryKey[0] === 'team-context' && queryKey[2] === 'shell') ||
      ['project-context', 'deployment-context', 'project-logs'].includes(
        String(queryKey[0]),
      ),
  }
  await queryClient.cancelQueries(filters)
  for (const query of queryClient.getQueryCache().findAll(filters)) {
    const cached = query.state.data as
      | Pick<TeamShellContext, 'team' | 'userContext'>
      | undefined
    if (!cached) continue
    const replaceTeam = (current: TeamSummary) =>
      current.id === team.id ? team : current
    queryClient.setQueryData(
      query.queryKey,
      {
        ...cached,
        team: replaceTeam(cached.team),
        userContext: {
          ...cached.userContext,
          teams: cached.userContext.teams.map(replaceTeam),
          defaultTeam: replaceTeam(cached.userContext.defaultTeam),
        },
      },
      { updatedAt: query.state.dataUpdatedAt },
    )
  }
}
