import { createFileRoute, redirect } from '@tanstack/react-router'

import { getCurrentUserContext } from '@/server/auth/context'
import { TeamInvite, TeamInvitePending } from '@/features/teams/team-invite'

export const Route = createFileRoute('/invites/$token')({
  ssr: false,
  loader: async ({ params }) => {
    if (!(await getCurrentUserContext())) {
      throw redirect({
        to: '/auth/login',
        search: { redirect: `/invites/${params.token}` },
      })
    }
  },
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: TeamInvitePending,
  component: TeamInviteRoute,
})

function TeamInviteRoute() {
  const { token } = Route.useParams()
  return <TeamInvite token={token} />
}
