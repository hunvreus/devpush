import { pageHead } from '#devpush/lib/page-head'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { getCurrentUserContext } from '#devpush/server/auth/context'

export const Route = createFileRoute('/')({
  loader: async () => {
    const context = await getCurrentUserContext()

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    if (context.user.profileConfirmedAt === null)
      throw redirect({ to: '/onboarding' })

    throw redirect({
      to: '/$teamSlug',
      params: { teamSlug: context.defaultTeam.slug },
    })
  },
  head: () => pageHead('Home'),
})
