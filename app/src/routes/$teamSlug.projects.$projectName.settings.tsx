import { pageHead } from '#devpush/lib/page-head'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { ProjectSettings } from '#devpush/features/projects/project-settings'
import { ProjectSectionPending } from '#devpush/features/projects/project-route-pending'
import { projectContextQueryOptions } from '#devpush/lib/project-context-query'

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/settings',
)({
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery(
      projectContextQueryOptions(
        {
          teamSlug: params.teamSlug,
          projectName: params.projectName,
          scope: 'settings',
        },
        context.queryClient,
      ),
    ),
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: SettingsPending,
  component: SettingsRoute,
  head: ({ params }) =>
    pageHead('Project settings', params.projectName, params.teamSlug),
})

function SettingsPending() {
  return <ProjectSectionPending section="settings" />
}

function SettingsRoute() {
  const queryClient = useQueryClient()
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/settings',
  })
  const { data: context } = useSuspenseQuery(
    projectContextQueryOptions(
      {
        teamSlug: params.teamSlug,
        projectName: params.projectName,
        scope: 'settings',
      },
      queryClient,
    ),
  )

  return <ProjectSettings key={context.project.id} context={context} />
}
