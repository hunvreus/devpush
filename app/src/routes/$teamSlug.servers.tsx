import { pageHead } from '@/lib/page-head'
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/$teamSlug/servers')({
  component: () => <Outlet />,
  head: ({ params }) => pageHead('Servers', params.teamSlug),
})
