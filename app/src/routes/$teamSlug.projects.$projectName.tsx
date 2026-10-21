import { pageHead } from '@/lib/page-head'
import { useRefreshError } from '@/lib/use-refresh-error'
import {
  Outlet,
  createFileRoute,
  useParams,
  useRouterState,
} from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { ProjectPage } from '@/features/projects/project-layout'
import { ProjectOverview } from '@/features/projects/project-overview'
import { ProjectRoutePending } from '@/features/projects/project-route-pending'
import { getProjectPendingSection } from '@/features/projects/pending-section'
import type { ProjectPendingSection } from '@/features/projects/pending-section'
import {
  projectContextQueryOptions,
  projectShellQueryOptions,
} from '@/lib/project-context-query'

export const Route = createFileRoute('/$teamSlug/projects/$projectName')({
  loader: async ({ context, location, params }) => {
    const scope = getProjectPendingSection(location.pathname)
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
  pendingComponent: ProjectPending,
  component: ProjectRoute,
  head: ({ params }) =>
    pageHead('Overview', params.projectName, params.teamSlug),
})

function ProjectRoute() {
  const params = useParams({ from: '/$teamSlug/projects/$projectName' })
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const pendingSection = getProjectPendingSection(pathname)

  return <ProjectContent params={params} pendingSection={pendingSection} />
}

function ProjectContent({
  params,
  pendingSection,
}: {
  params: { projectName: string; teamSlug: string }
  pendingSection: ProjectPendingSection
}) {
  const { data: shell } = useSuspenseQuery(
    projectShellQueryOptions({
      teamSlug: params.teamSlug,
      projectName: params.projectName,
    }),
  )

  const isOverview = pendingSection === 'overview'

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
