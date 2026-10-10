import { workspacePollInterval } from './workspace-updates'
import { queryOptions } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { getTeamServerContext } from '@/server/auth/context'

export function serverContextQueryOptions(params: {
  serverId: string
  teamSlug: string
}) {
  return queryOptions({
    queryKey: ['server-context', params.teamSlug, params.serverId],
    refetchInterval: () => workspacePollInterval(params.teamSlug, 5_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    queryFn: async () => {
      const context = await getTeamServerContext({ data: params })
      if (!context) throw redirect({ to: '/auth/login' })
      return context
    },
  })
}
