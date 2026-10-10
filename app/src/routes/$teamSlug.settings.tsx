import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { TeamSettings } from '@/features/teams/team-settings'
import { TeamSettingsPending } from '@/features/teams/team-route-pending'
import {
  teamSectionQueryOptions,
  teamShellQueryOptions,
} from '@/lib/team-context-query'

export const Route = createFileRoute('/$teamSlug/settings')({
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery(
      teamSectionQueryOptions({
        section: 'settings',
        teamSlug: params.teamSlug,
      }),
    ),
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: TeamSettingsPending,
  component: TeamSettingsRoute,
})

function TeamSettingsRoute() {
  const params = Route.useParams()
  const { data: shell } = useSuspenseQuery(
    teamShellQueryOptions({ teamSlug: params.teamSlug }),
  )
  const { data: section } = useSuspenseQuery(
    teamSectionQueryOptions({
      section: 'settings',
      teamSlug: params.teamSlug,
    }),
  )

  if (section.section !== 'settings') {
    throw new Error('Team settings context is unavailable.')
  }

  return (
    <TeamSettings
      team={shell.team}
      currentUserId={shell.userContext.user.id}
      isDefaultTeam={shell.userContext.user.defaultTeamId === shell.team.id}
      backupStorage={section.settings.backupStorage}
      members={section.settings.members}
      invites={section.settings.invites}
      canDeleteTeam={section.settings.deletionStatus.canDelete}
    />
  )
}
