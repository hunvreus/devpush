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

test('every page declares consistent browser and social titles with route context', () => {
  const router = getRouter()
  const cases = [
    ['/auth/login', 'Log in'],
    ['/settings', 'Account settings'],
    ['/admin', 'Administration'],
    ['/invites/$token', 'Team invitation'],
    ['/oauth/consent', 'Authorize application'],
    ['/', 'Home'],
    ['/$teamSlug', 'Overview – acme'],
    ['/$teamSlug/', 'Overview – acme'],
    ['/$teamSlug/projects', 'Projects – acme'],
    ['/$teamSlug/new-project', 'New project – acme'],
    ['/$teamSlug/settings', 'Team settings – acme'],
    ['/$teamSlug/servers', 'Servers – acme'],
    ['/$teamSlug/servers/', 'Servers – acme'],
    ['/$teamSlug/servers/$serverId', 'Production – acme'],
    ['/$teamSlug/projects/$projectName', 'Overview – website – acme'],
    [
      '/$teamSlug/projects/$projectName/deployments',
      'Deployments – website – acme',
    ],
    ['/$teamSlug/projects/$projectName/logs', 'Logs – website – acme'],
    [
      '/$teamSlug/projects/$projectName/settings',
      'Project settings – website – acme',
    ],
    ['/$teamSlug/projects/$projectName/backups', 'Backups – website – acme'],
    [
      '/$teamSlug/projects/$projectName/deployments/$deploymentId',
      'Deployment deploy-123 – website – acme',
    ],
    [
      '/$teamSlug/projects/$projectName/backups/$backupId',
      'Backup backup-456 – website – acme',
    ],
  ] as const

  for (const [id, label] of cases) {
    const head = router.routesById[id].options.head as unknown as (
      input: object,
    ) => { meta: Array<object> }
    expect(head, id).toBeTypeOf('function')
    const title = `${label} | devpush`
    expect(
      head({
        params: {
          teamSlug: 'acme',
          projectName: 'website',
          deploymentId: 'deploy-123',
          backupId: 'backup-456',
        },
        loaderData: { server: { name: 'Production' } },
      }).meta,
      id,
    ).toEqual([
      { title },
      { name: 'title', content: title },
      { property: 'og:title', content: title },
      { name: 'twitter:title', content: title },
    ])
  }
  router.options.context.queryClient.clear()
})
