import { createFileRoute, redirect } from '@tanstack/react-router'

import { UserSettings } from '@/features/users/user-settings'
import { UserSettingsPending } from '@/features/settings/settings-route-pending'
import { getUserSettingsContext } from '@/server/auth/context'

export const Route = createFileRoute('/settings')({
  ssr: false,
  loader: async () => {
    const context = await getUserSettingsContext()

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: UserSettingsPending,
  component: SettingsRoute,
})

function SettingsRoute() {
  const context = Route.useLoaderData()

  return <UserSettings context={context} />
}
