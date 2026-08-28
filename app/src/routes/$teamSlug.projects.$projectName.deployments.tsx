import { useSuspenseQuery } from '@tanstack/react-query'
import {
  Outlet,
  createFileRoute,
  useParams,
  useRouterState,
} from '@tanstack/react-router'

import { DeploymentsPage } from '@/features/deployments/deployments-page'
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
  validateSearch,
  component: DeploymentsRoute,
})

function DeploymentsRoute() {
  const filters = Route.useSearch()
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/deployments',
  })
  const { data: context } = useSuspenseQuery(
    projectContextQueryOptions({
      teamSlug: params.teamSlug,
      projectName: params.projectName,
    }),
  )
  const isIndex = useRouterState({
    select: (state) =>
      state.location.pathname ===
      `/${params.teamSlug}/projects/${params.projectName}/deployments`,
  })

  return isIndex ? (
    <DeploymentsPage context={context} filters={filters} />
  ) : (
    <Outlet />
  )
}
