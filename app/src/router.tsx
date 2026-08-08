import { createRouter as createTanStackRouter } from '@tanstack/react-router'
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
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: RouteErrorState,
    defaultNotFoundComponent: () => (
      <RouteNotFoundState
        title="Page not found"
        description="The page you requested does not exist, or you do not have access."
      />
    ),
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
