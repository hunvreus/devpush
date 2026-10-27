import { workspacePollInterval } from './workspace-updates'
import { queryOptions } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import {
  getTeamServerContext,
  getTeamServerMetricHistory,
} from '#devpush/server/servers/functions'

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

export function serverMetricHistoryQueryOptions(params: {
  serverId: string
  teamSlug: string
}) {
  return queryOptions({
    queryKey: ['server-metrics', params.teamSlug, params.serverId],
    staleTime: 30_000,
    refetchInterval: () => workspacePollInterval(params.teamSlug, 30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const history = await getTeamServerMetricHistory({ data: params })
      if (!history) throw redirect({ to: '/auth/login' })
      return history
    },
  })
}
