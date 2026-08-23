import { useSuspenseQuery } from '@tanstack/react-query'
import {
  Outlet,
  createFileRoute,
  useParams,
  useRouterState,
} from '@tanstack/react-router'
import { z } from 'zod'

import { DeploymentsPage } from '@/features/deployments/deployments-page'
import { projectContextQueryOptions } from '@/lib/project-context-query'

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/deployments',
)({
  validateSearch: z.object({
    branch: z.string().optional().catch(undefined),
    date: z.string().optional().catch(undefined),
    environment: z.string().optional().catch(undefined),
    status: z.string().optional().catch(undefined),
  }),
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
