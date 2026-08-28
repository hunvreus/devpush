import { getRouteApi, useParams } from '@tanstack/react-router'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ResourceAvatar } from '@/components/resource-avatar'
import { SectionNavigation } from '@/components/section-navigation'
import { Skeleton } from '@/components/ui/skeleton'

const teamRoute = getRouteApi('/$teamSlug')

export function ServerDetailPending() {
  const params = useParams({ strict: false })
  const context = teamRoute.useLoaderData()
  const serverId = typeof params.serverId === 'string' ? params.serverId : ''
  const server = context.servers.find((item) => item.id === serverId)

  return (
    <div className="space-y-8" aria-label="Loading server">
      <section>
        <h1 className="flex min-w-0 items-center gap-x-3 text-2xl font-medium">
          <a href={`/${context.team.slug}`}>
            <ResourceAvatar
              name={context.team.name}
              src={context.team.image ?? undefined}
              color={context.team.color}
              size="md"
            />
          </a>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <span>Servers</span>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <span className="truncate">{server?.name ?? serverId}</span>
        </h1>
      </section>
      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <div className="space-y-8">
          <ServerGeneralPending />
          <ServerHostPending />
          <Card>
            <CardHeader className="space-y-2 border-b">
              <CardTitle>Metrics</CardTitle>
              <CardDescription>
                Up to 24 hours of host resource history. Missing samples remain
                visible as gaps.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="h-[230px] rounded-lg border p-4">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">
                      {
                        [
                          'CPU usage',
                          'Memory usage',
                          'Disk usage',
                          'Network traffic',
                        ][index]
                      }
                    </span>
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="mt-6 h-36 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="space-y-2 border-b">
              <CardTitle>Danger</CardTitle>
              <CardDescription>
                Administrative actions that affect this server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-8 w-36" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        </div>
        <SectionNavigation
          className="hidden lg:flex"
          items={[
            { href: '#general', label: 'General' },
            { href: '#host', label: 'Host' },
            { href: '#metrics', label: 'Metrics' },
            { href: '#danger', label: 'Danger', destructive: true },
          ]}
        />
      </div>
    </div>
  )
}

function ServerGeneralPending() {
  return (
    <Card>
      <CardHeader className="space-y-2 border-b">
        <CardTitle>General</CardTitle>
        <CardDescription>Basic details for this server.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <span className="text-sm font-medium">Status</span>
          <div className="flex items-center gap-2">
            <Skeleton className="size-5 shrink-0 rounded-md" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
        <div className="space-y-2">
          <span className="text-sm font-medium">Name</span>
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="space-y-2">
          <span className="text-sm font-medium">Server ID</span>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
      </CardFooter>
    </Card>
  )
}

function ServerHostPending() {
  return (
    <Card>
      <CardHeader className="space-y-2 border-b">
        <CardTitle>Host</CardTitle>
        <CardDescription>
          System information reported by the agent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {[
            'Hostname',
            'Operating system',
            'CPU',
            'Memory',
            'Architecture',
            'Host uptime',
            'Kernel',
            'Agent version',
          ].map((label, index) => (
            <div className="space-y-2" key={index}>
              <span className="font-medium">{label}</span>
              <Skeleton className={index % 3 === 0 ? 'h-4 w-40' : 'h-4 w-28'} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
