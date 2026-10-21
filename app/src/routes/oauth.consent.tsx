import { pageHead } from '@/lib/page-head'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { McpConsent, McpConsentPending } from '@/features/users/mcp-consent'
import { getMcpConsentAction } from '@/server/mcp/functions'

export const Route = createFileRoute('/oauth/consent')({
  ssr: false,
  server: {
    handlers: {
      GET: ({ request, next }) => {
        const url = new URL(request.url)
        // The provider signs repeated query parameters. Wrap the original
        // bytes before the router's search normalization can rewrite them.
        if (
          url.search &&
          !(url.searchParams.size === 1 && url.searchParams.has('oauthQuery'))
        ) {
          return new Response(null, {
            status: 302,
            headers: {
              location: `/oauth/consent?oauthQuery=${encodeURIComponent(url.search.slice(1))}`,
              'cache-control': 'no-store',
            },
          })
        }
        return next()
      },
    },
  },
  validateSearch: (search: Record<string, unknown>) => ({
    oauthQuery: typeof search.oauthQuery === 'string' ? search.oauthQuery : '',
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const context = await getMcpConsentAction({ data: deps })
    if (!context)
      throw redirect({
        to: '/auth/login',
        search: {
          redirect: `/oauth/consent?oauthQuery=${encodeURIComponent(deps.oauthQuery)}`,
        },
      })
    return context
  },
  component: ConsentRoute,
  pendingComponent: McpConsentPending,
  head: () => pageHead('Authorize application'),
})
function ConsentRoute() {
  return <McpConsent context={Route.useLoaderData()} />
}
