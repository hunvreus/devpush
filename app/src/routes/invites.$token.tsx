import { pageHead } from '@/lib/page-head'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { getCurrentUserContext } from '@/server/auth/context'
import { TeamInvite, TeamInvitePending } from '@/features/teams/team-invite'

export const Route = createFileRoute('/invites/$token')({
  ssr: false,
  loader: async ({ params }) => {
    const context = await getCurrentUserContext()
    if (context?.user.profileConfirmedAt === null)
      throw redirect({
        to: '/onboarding',
        search: { redirect: `/invites/${params.token}` },
      })
    if (!context) {
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
  head: () => pageHead('Team invitation'),
})

function TeamInviteRoute() {
  const { token } = Route.useParams()
  return <TeamInvite token={token} />
}
