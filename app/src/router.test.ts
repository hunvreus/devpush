import { expect, test } from 'vitest'
import { getRouter } from './router'

test('authenticated routes render pending documents and use consistent navigation feedback', () => {
  const router = getRouter()
  expect(router.options.defaultPendingMs).toBe(150)
  expect(router.options.defaultPendingMinMs).toBe(200)
  expect(router.options.defaultStaleTime).toBe(0)
  expect(router.options.defaultPreloadStaleTime).toBe(0)
  for (const id of [
    '/$teamSlug',
    '/settings',
    '/admin',
    '/invites/$token',
  ] as const) {
    expect(router.routesById[id].options.ssr).toBe(false)
    expect(router.routesById[id].options.pendingComponent).toBeDefined()
  }
  // Public login keeps server rendering; auth is still enforced by server functions.
  expect(router.routesById['/auth/login'].options.ssr).not.toBe(false)
  router.options.context.queryClient.clear()
})
