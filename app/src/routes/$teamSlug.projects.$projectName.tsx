import { pageHead } from '#devpush/lib/page-head'
import { useRefreshError } from '#devpush/lib/use-refresh-error'
import {
  Outlet,
  createFileRoute,
  useParams,
  useRouterState,
  useChildMatches,
} from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { ProjectPage } from '#devpush/features/projects/project-layout'
import { ProjectOverview } from '#devpush/features/projects/project-overview'
import { ProjectRoutePending, preloadProjectPendingPage } from '#devpush/features/projects/project-route-pending'
import { getProjectPendingSection } from '#devpush/features/projects/pending-section'
import {
  projectContextQueryOptions,
  projectShellQueryOptions,
} from '#devpush/lib/project-context-query'

export const Route = createFileRoute('/$teamSlug/projects/$projectName')({
  loader: async ({ context, location, params }) => {
    const scope = getProjectPendingSection(location.pathname)
    preloadProjectPendingPage(scope)
    const shell = context.queryClient.fetchQuery(
      projectShellQueryOptions({
        teamSlug: params.teamSlug,
        projectName: params.projectName,
      }),
    )

    if (scope !== 'overview') return shell

    await Promise.all([
      shell,
      context.queryClient.fetchQuery(
        projectContextQueryOptions(
          {
            teamSlug: params.teamSlug,
            projectName: params.projectName,
            scope: 'overview',
          },
          context.queryClient,
        ),
      ),
    ])
  },
  pendingMs: 0,
  pendingComponent: ProjectPending,
  component: ProjectRoute,
  head: ({ params }) =>
    pageHead('Overview', params.projectName, params.teamSlug),
})

function ProjectRoute() {
  const params = useParams({ from: '/$teamSlug/projects/$projectName' })
  const isOverview = useChildMatches({
    select: (matches) => matches.length === 0,
  })

  return <ProjectContent params={params} isOverview={isOverview} />
}

function ProjectContent({
  params,
  isOverview,
}: {
  params: { projectName: string; teamSlug: string }
  isOverview: boolean
}) {
  const { data: shell } = useSuspenseQuery(
    projectShellQueryOptions({
      teamSlug: params.teamSlug,
      projectName: params.projectName,
    }),
  )

  return (
    <ProjectPage context={shell}>
      {isOverview ? <ProjectOverviewContent params={params} /> : <Outlet />}
    </ProjectPage>
  )
}

function ProjectOverviewContent({
  params,
}: {
  params: { projectName: string; teamSlug: string }
}) {
  const queryClient = useQueryClient()
  const { data: context, error } = useSuspenseQuery(
    projectContextQueryOptions({ ...params, scope: 'overview' }, queryClient),
  )

  useRefreshError(error, 'project-deployments-refresh')

  return <ProjectOverview context={context} />
}

function ProjectPending() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return <ProjectRoutePending section={getProjectPendingSection(pathname)} />
}
