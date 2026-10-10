import { useRefreshError } from '@/lib/use-refresh-error'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  Outlet,
  createFileRoute,
  useParams,
  useRouterState,
} from '@tanstack/react-router'

import { DeploymentsPage } from '@/features/deployments/deployments-page'
import { ProjectSectionPending } from '@/features/projects/project-route-pending'
import { projectContextQueryOptions } from '@/lib/project-context-query'
import { stringSearchValidator } from '@/lib/search'

const validateSearch = stringSearchValidator([
  'branch',
  'date',
  'environment',
  'status',
] as const)

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/deployments',
)({
  loader: ({ context, location, params }) => {
    if (!location.pathname.endsWith('/deployments')) {
      return
    }

    return context.queryClient.fetchQuery(
      projectContextQueryOptions(
        {
          teamSlug: params.teamSlug,
          projectName: params.projectName,
          scope: 'deployments',
        },
        context.queryClient,
      ),
    )
  },
  validateSearch,
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: DeploymentsPending,
  component: DeploymentsRoute,
})

function DeploymentsPending() {
  return <ProjectSectionPending section="deployments" />
}

function DeploymentsRoute() {
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/deployments',
  })
  const isIndex = useRouterState({
    select: (state) => state.location.pathname.endsWith('/deployments'),
  })

  if (!isIndex) return <Outlet />

  return <DeploymentsIndex params={params} />
}

function DeploymentsIndex({
  params,
}: {
  params: { projectName: string; teamSlug: string }
}) {
  const filters = Route.useSearch()
  const queryClient = useQueryClient()
  const { data: context, error } = useSuspenseQuery(
    projectContextQueryOptions(
      {
        teamSlug: params.teamSlug,
        projectName: params.projectName,
        scope: 'deployments',
      },
      queryClient,
    ),
  )

  useRefreshError(error, 'project-deployments-refresh')

  return <DeploymentsPage context={context} filters={filters} />
}
