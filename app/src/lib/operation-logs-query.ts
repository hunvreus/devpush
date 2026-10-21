import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

type OperationLogs = { content: string; nextOffset: number }
export function operationLogsQueryOptions(
  params: { teamSlug: string; type: 'backup' | 'restore'; id: string },
  queryClient: QueryClient,
) {
  const queryKey = ['operation-logs', params.teamSlug, params.type, params.id]
  return queryOptions({
    queryKey,
    retry: false,
    staleTime: 5_000,
    gcTime: 60_000,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }): Promise<OperationLogs> => {
      let cached = queryClient.getQueryData<OperationLogs>(queryKey)
      let offset = cached?.nextOffset ?? 0
      const search = new URLSearchParams({
        type: params.type,
        id: params.id,
        offset: String(offset),
      })
      let response = await fetch(`/api/agents/job-logs?${search}`, { signal })
      if (response.status === 409 && cached) {
        // Retention may remove chunks beyond an old cursor. Restart from the
        // retained output, keeping the old display until that read succeeds.
        cached = undefined
        offset = 0
        search.set('offset', '0')
        response = await fetch(`/api/agents/job-logs?${search}`, { signal })
      }
      if (!response.ok) throw new Error('Unable to load logs. Try again.')
      const result = (await response.json()) as OperationLogs
      if (
        typeof result.content !== 'string' ||
        !Number.isSafeInteger(result.nextOffset) ||
        result.nextOffset < offset ||
        result.nextOffset <
          offset + new TextEncoder().encode(result.content).length
      )
        throw new Error('Invalid operation log response. Try again.')
      return {
        content: (cached?.content ?? '') + result.content,
        nextOffset: result.nextOffset,
      }
    },
  })
}
