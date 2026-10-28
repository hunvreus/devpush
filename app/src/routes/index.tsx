import { pageHead } from '#devpush/lib/page-head'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { currentUserContextQueryOptions } from '#devpush/features/auth/current-user-context-query'

export const Route = createFileRoute('/')({
  loader: async ({ context: routerContext }) => {
    const context = await routerContext.queryClient.fetchQuery(
      currentUserContextQueryOptions(),
    )

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
