import { pageHead } from '#devpush/lib/page-head'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { TeamSettings } from '#devpush/features/teams/team-settings'
import { TeamSettingsPending, teamSettingsModule } from '#devpush/features/teams/team-route-pending'
import {
  teamSectionQueryOptions,
  teamShellQueryOptions,
} from '#devpush/lib/team-context-query'

export const Route = createFileRoute('/$teamSlug/settings')({
  loader: ({ context, params }) => {
    void teamSettingsModule.load()
    return context.queryClient.fetchQuery(
      teamSectionQueryOptions({
        section: 'settings',
        teamSlug: params.teamSlug,
      }),
    )
  },
  pendingMs: 150,
  pendingComponent: TeamSettingsPending,
  component: TeamSettingsRoute,
  head: ({ params }) => pageHead('Team settings', params.teamSlug),
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
      key={shell.team.id}
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
