import { createFileRoute, redirect } from '@tanstack/react-router'

import { AdminSettings } from '@/features/admin/admin-settings'
import { getAdminSettingsContext } from '@/server/admin/functions'

export const Route = createFileRoute('/admin')({
  loader: async () => {
    const context = await getAdminSettingsContext()

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  component: AdminRoute,
})

function AdminRoute() {
  const { adminOverview, userContext } = Route.useLoaderData()

  return (
    <AdminSettings
      currentUserId={userContext.user.id}
      overview={adminOverview}
    />
  )
}
