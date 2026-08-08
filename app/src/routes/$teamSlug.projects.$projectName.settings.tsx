import { createFileRoute, useParams } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'

import { ProjectSettings } from '@/features/projects/project-settings'
import { projectContextQueryOptions } from '@/lib/project-context-query'

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/settings',
)({
  component: SettingsRoute,
})

function SettingsRoute() {
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/settings',
  })
  const { data: context } = useSuspenseQuery(
    projectContextQueryOptions({
      teamSlug: params.teamSlug,
      projectName: params.projectName,
    }),
  )

  return <ProjectSettings context={context} />
}
