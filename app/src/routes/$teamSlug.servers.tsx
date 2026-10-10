import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/$teamSlug/servers')({
  component: () => <Outlet />,
})
