import {
  Outlet,
  createFileRoute,
  notFound,
  useParams,
  useRouterState,
} from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'

import { ProjectBackups } from '@/features/projects/project-backups'
import { projectContextQueryOptions } from '@/lib/project-context-query'
import { stringSearchValidator } from '@/lib/search'

const validateSearch = stringSearchValidator([
  'environment',
  'server',
  'status',
  'time',
] as const)

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/backups',
)({
  beforeLoad: () => {
    if (import.meta.env.VITE_DEVPUSH_BACKUPS_ENABLED !== 'true') {
      throw notFound()
    }
  },
  validateSearch,
  component: BackupsRoute,
})

function BackupsRoute() {
  const filters = Route.useSearch()
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/backups',
  })
  const { data: context } = useSuspenseQuery(
    projectContextQueryOptions({
      teamSlug: params.teamSlug,
      projectName: params.projectName,
    }),
  )
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (
    pathname !== `/${params.teamSlug}/projects/${params.projectName}/backups`
  ) {
    return <Outlet />
  }

  return <ProjectBackups context={context} filters={filters} />
}
