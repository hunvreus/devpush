import { createFileRoute, notFound, useParams } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'

import { ProjectBackupDetails } from '@/features/projects/project-backups'
import { projectContextQueryOptions } from '@/lib/project-context-query'

export const Route = createFileRoute(
  '/$teamSlug/projects/$projectName/backups/$backupId',
)({
  beforeLoad: () => {
    if (import.meta.env.VITE_DEVPUSH_BACKUPS_ENABLED !== 'true') {
      throw notFound()
    }
  },
  component: BackupPolicyRoute,
})

function BackupPolicyRoute() {
  const { backupId } = Route.useParams()
  const params = useParams({
    from: '/$teamSlug/projects/$projectName/backups/$backupId',
  })
  const { data: context } = useSuspenseQuery(
    projectContextQueryOptions({
      teamSlug: params.teamSlug,
      projectName: params.projectName,
    }),
  )

  return <ProjectBackupDetails context={context} backupId={backupId} />
}
