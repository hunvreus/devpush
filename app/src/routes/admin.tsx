import { pageHead } from '#devpush/lib/page-head'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { adminSearchSchema } from '#devpush/lib/admin-search-schema'
import { AdminSettings } from '#devpush/features/admin/admin-settings'
import { AdminSettingsPending } from '#devpush/features/settings/settings-route-pending'
import { getAdminSettingsContext } from '#devpush/server/admin/functions'

export const Route = createFileRoute('/admin')({
  ssr: false,
  validateSearch: (search) => adminSearchSchema.parse(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    let context

    try {
      context = await getAdminSettingsContext({ data: deps })
    } catch (error) {
      if (error instanceof Error && error.message === 'Forbidden') {
        throw redirect({ to: '/' })
      }
      throw error
    }

    if (!context) {
      throw redirect({ to: '/auth/login' })
    }

    return context
  },
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: AdminSettingsPending,
  component: AdminRoute,
  head: () => pageHead('Administration'),
})

function AdminRoute() {
  const navigate = Route.useNavigate()
  const { adminOverview, userContext } = Route.useLoaderData()

  return (
    <AdminSettings
      currentUserId={userContext.user.id}
      overview={adminOverview}
      onSearchChange={(search) => {
        void navigate({
          search: (previous) => ({ ...previous, ...search }),
          replace: true,
          resetScroll: false,
        })
      }}
    />
  )
}
