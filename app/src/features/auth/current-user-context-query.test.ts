import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { currentUserContextQueryOptions } from './current-user-context-query'
import { invalidateResourceQueries } from '#devpush/lib/resource-cache'

const currentUser = vi.hoisted(() => vi.fn())
vi.mock('#devpush/server/auth/context', () => ({
  getCurrentUserContext: currentUser,
}))

test('navigation and prefetch share the onboarding check until account data is invalidated', async () => {
  const client = new QueryClient()
  currentUser.mockResolvedValueOnce({ user: { profileConfirmedAt: 1 } })
  expect(await client.fetchQuery(currentUserContextQueryOptions())).toEqual({
    user: { profileConfirmedAt: 1 },
  })
  await client.fetchQuery(currentUserContextQueryOptions())
  expect(currentUser).toHaveBeenCalledTimes(1)
  await invalidateResourceQueries(client)
  currentUser.mockResolvedValueOnce({ user: { profileConfirmedAt: null } })
  expect(await client.fetchQuery(currentUserContextQueryOptions())).toEqual({
    user: { profileConfirmedAt: null },
  })
  expect(currentUser).toHaveBeenCalledTimes(2)
  client.clear()
})
