import { createFileRoute, useParams } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { ProjectSettings } from '@/features/projects/project-settings'
import { ProjectSectionPending } from '@/features/projects/project-route-pending'
import { projectContextQueryOptions } from '@/lib/project-context-query'

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

  return <ProjectSettings context={context} />
}
