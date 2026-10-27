import { backupsEnabled } from '#devpush/lib/backup-feature'
import { pageHead } from '#devpush/lib/page-head'
import {
  Outlet,
  createFileRoute,
  notFound,
  useParams,
  useRouterState,
} from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { ProjectBackups } from '#devpush/features/projects/project-backups'
import { ProjectSectionPending } from '#devpush/features/projects/project-route-pending'
import { projectContextQueryOptions } from '#devpush/lib/project-context-query'
import { stringSearchValidator } from '#devpush/lib/search'

const validateSearch = stringSearchValidator([
  'policy',
  'environment',
  'server',
  'status',
  'time',
  'type',
] as const)

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/backups',
)({
  beforeLoad: () => {
    if (!backupsEnabled) {
      throw notFound()
    }
  },
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery(
      projectContextQueryOptions(
        {
          teamSlug: params.teamSlug,
          projectName: params.projectName,
          scope: 'backups',
        },
        context.queryClient,
      ),
    ),
  validateSearch,
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: BackupsPending,
  component: BackupsRoute,
  head: ({ params }) =>
    pageHead('Backups', params.projectName, params.teamSlug),
})

function BackupsPending() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname.endsWith('/backups'),
  })
  return <ProjectSectionPending section={isIndex ? 'backups' : 'backup'} />
}

function BackupsRoute() {
  const queryClient = useQueryClient()
  const filters = Route.useSearch()
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/backups',
  })
  const { data: context } = useSuspenseQuery(
    projectContextQueryOptions(
      {
        teamSlug: params.teamSlug,
        projectName: params.projectName,
        scope: 'backups',
      },
      queryClient,
    ),
  )
  const isIndex = useRouterState({
    select: (state) => state.location.pathname.endsWith('/backups'),
  })

  if (!isIndex) return <Outlet />

  return <ProjectBackups context={context} filters={filters} />
}
