import { createFileRoute, redirect } from '@tanstack/react-router'

import { UserSettings } from '@/features/users/user-settings'
import { getUserSettingsContext } from '@/server/auth/context'

export const Route = createFileRoute('/settings')({
  loader: async () => {
    const context = await getUserSettingsContext()

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  const context = Route.useLoaderData()

  return <UserSettings context={context} />
}
