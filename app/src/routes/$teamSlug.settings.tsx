import { createFileRoute, redirect } from '@tanstack/react-router'

import { TeamSettings } from '@/features/teams/team-settings'
import { TeamPage } from '@/features/teams/team-header'
import { getTeamSettingsContext } from '@/server/auth/context'

export const Route = createFileRoute('/$teamSlug/settings')({
  loader: async ({ params }) => {
    const context = await getTeamSettingsContext({
      data: { teamSlug: params.teamSlug },
    })

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  component: TeamSettingsRoute,
})

function TeamSettingsRoute() {
  const context = Route.useLoaderData()

  return (
    <TeamPage
      userContext={context.userContext}
      currentTeam={context.team}
      servers={context.servers}
      contentClassName="space-y-8"
    >
      <TeamSettings
        team={context.team}
        currentUserId={context.userContext.user.id}
        isDefaultTeam={
          context.userContext.user.defaultTeamId === context.team.id
        }
        members={context.members}
        invites={context.invites}
        canDeleteTeam={context.deletionStatus.canDelete}
      />
    </TeamPage>
  )
}
