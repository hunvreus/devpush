import { queryOptions } from '@tanstack/react-query'
import { getCurrentUserContext } from '#devpush/server/auth/context'

// This only controls the onboarding redirect. Protected data and mutations
// still validate the current session and permissions on the server.
export const currentUserContextQueryOptions = () =>
  queryOptions({
    queryKey: ['current-user-context'],
    queryFn: () => getCurrentUserContext(),
    staleTime: 30_000,
  })
