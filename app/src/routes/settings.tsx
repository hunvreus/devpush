import { pageHead } from '#devpush/lib/page-head'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { UserSettings } from '#devpush/features/users/user-settings'
import { UserSettingsPending, userSettingsModule } from '#devpush/features/settings/settings-route-pending'
import { getUserSettingsContext } from '#devpush/server/users/functions'

export const Route = createFileRoute('/settings')({
  ssr: false,
  loader: async () => {
    void userSettingsModule.load()
    const context = await getUserSettingsContext()

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  pendingMs: 150,
  pendingComponent: UserSettingsPending,
  component: SettingsRoute,
  head: () => pageHead('Account settings'),
})

function SettingsRoute() {
  const context = Route.useLoaderData()

  return <UserSettings key={context.user.id} context={context} />
}
