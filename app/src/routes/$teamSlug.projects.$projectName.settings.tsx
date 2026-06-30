import { createFileRoute, redirect } from '@tanstack/react-router'

import { ProjectLayout } from '@/features/projects/project-layout'
import { ProjectSettings } from '@/features/projects/project-settings'
import { getProject } from '@/server/projects/functions'

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/settings',
)({
  loader: async ({ params }) => {
    const context = await getProject({
      data: {
        teamSlug: params.teamSlug,
        projectName: params.projectName,
      },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  const context = Route.useLoaderData()

  return (
    <ProjectLayout context={context} contentClassName="space-y-8">
      <ProjectSettings context={context} />
    </ProjectLayout>
  )
}
