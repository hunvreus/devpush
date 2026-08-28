import {
  Outlet,
  createFileRoute,
  useParams,
  useRouterState,
} from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'

import { ProjectLayout } from '@/features/projects/project-layout'
import { ProjectOverview } from '@/features/projects/project-overview'
import { ProjectRoutePending } from '@/features/projects/project-route-pending'
import type { ProjectPendingSection } from '@/features/projects/project-route-pending'
import { projectContextQueryOptions } from '@/lib/project-context-query'
import { useVisibleRefresh } from '@/lib/use-visible-refresh'

export const Route = createFileRoute('/$teamSlug/projects/$projectName')({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      projectContextQueryOptions({
        teamSlug: params.teamSlug,
        projectName: params.projectName,
      }),
    )
  },
  pendingComponent: ProjectPending,
  component: ProjectRoute,
})

function ProjectRoute() {
  const params = useParams({ from: '/$teamSlug/projects/$projectName' })
  const { data: context, refetch } = useSuspenseQuery(
    projectContextQueryOptions({
      teamSlug: params.teamSlug,
      projectName: params.projectName,
    }),
  )
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const isOverview =
    pathname === `/${params.teamSlug}/projects/${params.projectName}`

  useVisibleRefresh(refetch)

  return (
    <ProjectLayout context={context} contentClassName="space-y-8">
      {isOverview ? <ProjectOverview context={context} /> : <Outlet />}
    </ProjectLayout>
  )
}

function ProjectPending() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return <ProjectRoutePending section={getPendingSection(pathname)} />
}

function getPendingSection(pathname: string): ProjectPendingSection {
  if (pathname.endsWith('/settings')) return 'settings'
  if (pathname.endsWith('/logs')) return 'logs'

  const backupPath = pathname.split('/backups/')[1]
  if (backupPath) return 'backup'
  if (pathname.endsWith('/backups')) return 'backups'

  const deploymentPath = pathname.split('/deployments/')[1]
  if (deploymentPath) return 'deployment'
  if (pathname.endsWith('/deployments')) return 'deployments'

  return 'overview'
}
