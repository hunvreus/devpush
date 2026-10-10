import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { NewProjectDialog } from '@/features/repositories/new-project-dialog'
import { NewProjectPending } from '@/features/repositories/new-project-pending'
import { teamShellQueryOptions } from '@/lib/team-context-query'

export const Route = createFileRoute('/$teamSlug/new-project')({
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery(
      teamShellQueryOptions({ teamSlug: params.teamSlug }),
    ),
  pendingComponent: NewProjectPending,
  component: NewProjectRoute,
})

function NewProjectRoute() {
  const { teamSlug } = Route.useParams()
  const { data: context } = useSuspenseQuery(
    teamShellQueryOptions({ teamSlug }),
  )

  return <NewProjectDialog team={context.team} servers={context.servers} />
}
