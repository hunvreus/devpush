import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import {
  RouteErrorState,
  RouteNotFoundState,
} from './components/route-error-state'
import { createQueryClient } from './lib/query'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = createQueryClient()
  const router = createTanStackRouter({
    routeTree,
    context: {
      queryClient,
    },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPendingMs: 150,
    defaultPendingMinMs: 200,
    defaultPreloadStaleTime: 0,
    // Query freshness owns data reuse; route loaders must observe invalidation.
    defaultStaleTime: 0,
    defaultErrorComponent: RouteErrorState,
    defaultNotFoundComponent: () => (
      <RouteNotFoundState
        title="Page not found"
        description="The page you requested does not exist, or you do not have access."
      />
    ),
  })

  setupRouterSsrQueryIntegration({
    queryClient,
    router,
    wrapQueryClient: false,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
