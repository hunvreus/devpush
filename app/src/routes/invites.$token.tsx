import { createFileRoute, redirect } from '@tanstack/react-router'

import { acceptTeamInviteAction } from '@/server/teams/functions'

export const Route = createFileRoute('/invites/$token')({
  loader: async ({ params }) => {
    try {
      const teamSlug = await acceptTeamInviteAction({
        data: { token: params.token },
      })

      throw redirect({ to: '/$teamSlug', params: { teamSlug } })
    } catch (error) {
      if (error && typeof error === 'object' && 'routeId' in error) {
        throw error
      }

      throw redirect({
        to: '/settings',
        hash: 'teams',
      })
    }
  },
})
