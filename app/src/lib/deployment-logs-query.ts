import { workspacePollInterval } from './workspace-updates'
import type { QueryClient } from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { isRedirect, redirect } from '@tanstack/react-router'

import { getDeploymentLogs } from '#devpush/server/projects/functions'

export function deploymentLogsQueryOptions({
  completed,
  deploymentId,
  projectName,
  teamSlug,
  queryClient,
}: {
  completed: boolean
  deploymentId: string
  projectName: string
  teamSlug: string
  queryClient?: QueryClient
}) {
  const runningLogs = completed
    ? queryClient?.getQueryData<Awaited<ReturnType<typeof getDeploymentLogs>>>([
        'deployment-logs',
        teamSlug,
        projectName,
        deploymentId,
        false,
      ])
    : undefined
  return queryOptions({
    // These reads tolerate a brief network interruption. Most application
    // queries disable retries, but one failed poll must not raise a log alert.
    retry: (failures, error) => failures < 2 && !isRedirect(error),
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
    // Preserve this deployment's output while fetching its final snapshot.
    initialData: runningLogs ?? undefined,
    initialDataUpdatedAt: runningLogs ? 0 : undefined,
    refetchOnWindowFocus: !completed,
    refetchOnReconnect: !completed,
    // Completion gets a fresh snapshot even if the last running poll just finished.
    queryKey: [
      'deployment-logs',
      teamSlug,
      projectName,
      deploymentId,
      completed,
    ],
    refetchIntervalInBackground: false,
    refetchInterval: () =>
      completed ? false : workspacePollInterval(teamSlug, 2_000),
    queryFn: async () => {
      const logs = await getDeploymentLogs({
        data: { deploymentId, projectName, teamSlug },
      })

      if (!logs) {
        throw redirect({ to: '/auth/login' })
      }

      return logs
    },
  })
}
