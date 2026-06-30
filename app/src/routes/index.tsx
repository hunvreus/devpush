import { createFileRoute, redirect } from '@tanstack/react-router'

import { getCurrentUserContext } from '@/server/auth/context'

export const Route = createFileRoute('/')({
  loader: async () => {
    const context = await getCurrentUserContext()

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    throw redirect({
      to: '/$teamSlug',
      params: { teamSlug: context.defaultTeam.slug },
    })
  },
})
