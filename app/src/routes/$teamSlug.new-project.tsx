import { pageHead } from '@/lib/page-head'
import { createFileRoute } from '@tanstack/react-router'
import { NewProjectRouteDialog } from '@/features/repositories/new-project-dialog'

export const Route = createFileRoute('/$teamSlug/new-project')({
  component: NewProjectRoute,
  head: ({ params }) => pageHead('New project', params.teamSlug),
})

function NewProjectRoute() {
  const { teamSlug } = Route.useParams()
  return <NewProjectRouteDialog teamSlug={teamSlug} />
}
