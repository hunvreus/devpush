import { getStorageCapabilities } from '#devpush/server/storage/capabilities'
import { ImageUploadsContext } from '#devpush/components/storage-capabilities'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'

import {
  RouteErrorState,
  RouteNotFoundState,
} from '#devpush/components/route-error-state'
import { Toaster } from '#devpush/components/ui/sonner'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import appCss from '../styles.css?url'

const appName = 'devpush'
const appDescription = 'Docker Compose deployments through devpush agents.'
const socialImage = '/social.png?v=2'

type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: () => getStorageCapabilities(),
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: appName,
      },
      {
        name: 'title',
        content: appName,
      },
      {
        name: 'description',
        content: appDescription,
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        property: 'og:title',
        content: appName,
      },
      {
        property: 'og:description',
        content: appDescription,
      },
      {
        property: 'og:image',
        content: socialImage,
      },
      {
        property: 'og:site_name',
        content: appName,
      },
      {
        property: 'og:locale',
        content: 'en_US',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
      {
        name: 'twitter:title',
        content: appName,
      },
      {
        name: 'twitter:description',
        content: appDescription,
      },
      {
        name: 'twitter:image',
        content: socialImage,
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/favicon.svg?v=2',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png?v=2',
      },
    ],
  }),
  component: RootComponent,
  errorComponent: RouteErrorState,
  notFoundComponent: NotFoundComponent,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  const { imageUploads } = Route.useLoaderData()

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ImageUploadsContext.Provider value={imageUploads}>
          <Outlet />
        </ImageUploadsContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function NotFoundComponent() {
  return (
    <RouteNotFoundState
      title="Page not found"
      description="The page you requested does not exist, or you do not have access."
    />
  )
}
