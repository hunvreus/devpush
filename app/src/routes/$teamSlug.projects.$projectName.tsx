import {
  Outlet,
  createFileRoute,
  useParams,
  useRouterState,
} from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'

import { Skeleton } from '@/components/ui/skeleton'
import { ProjectLayout } from '@/features/projects/project-layout'
import { ProjectOverview } from '@/features/projects/project-overview'
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
  return (
    <div className="space-y-8" aria-label="Loading project">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-lg" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}
