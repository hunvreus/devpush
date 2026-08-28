import { getRouteApi, useParams } from '@tanstack/react-router'

import { ResourceAvatar } from '@/components/resource-avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionNavigation } from '@/components/section-navigation'
import type { SectionNavigationItem } from '@/components/section-navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const teamRoute = getRouteApi('/$teamSlug')

type PendingProjectContext = {
  avatarUrl: string | null
  color?:
    | 'amber'
    | 'blue'
    | 'green'
    | 'neutral'
    | 'rose'
    | 'lime'
    | 'sky'
    | 'zinc'
  deploymentId: string | null
  projectName: string
  teamSlug: string
}

const projectSettingsNavigationItems: Array<SectionNavigationItem> = [
  { href: '#general', label: 'General' },
  { href: '#build-and-deploy', label: 'Build & Deploy' },
  { href: '#environments', label: 'Environments' },
  { href: '#environment-variables', label: 'Environment variables' },
  { href: '#servers', label: 'Servers' },
  { href: '#routes', label: 'Routes' },
  { href: '#domains', label: 'Domains' },
  { href: '#danger', label: 'Danger', destructive: true },
]

const backupNavigationItems: Array<SectionNavigationItem> = [
  { href: '#general', label: 'General' },
  { href: '#destination', label: 'Remote backups' },
  { href: '#retention', label: 'Retention' },
  { href: '#volumes', label: 'Volumes' },
  { href: '#databases', label: 'Databases' },
  { href: '#danger', label: 'Danger', destructive: true },
]

export type ProjectPendingSection =
  | 'backup'
  | 'backups'
  | 'deployment'
  | 'deployments'
  | 'logs'
  | 'overview'
  | 'settings'

export function ProjectRoutePending({
  section,
}: {
  section: ProjectPendingSection
}) {
  const params = useParams({ strict: false })
  const teamContext = teamRoute.useLoaderData()
  const projectName =
    typeof params.projectName === 'string' ? params.projectName : 'Project'
  const project = teamContext.projects.find((item) => item.name === projectName)
  const pendingContext: PendingProjectContext = {
    avatarUrl: project?.avatarUrl ?? null,
    color: project?.color,
    deploymentId:
      typeof params.deploymentId === 'string' ? params.deploymentId : null,
    projectName,
    teamSlug:
      typeof params.teamSlug === 'string'
        ? params.teamSlug
        : teamContext.team.slug,
  }

  if (section === 'settings') {
    return <ProjectSettingsPending context={pendingContext} />
  }

  if (section === 'deployment') {
    return <DeploymentDetailPending context={pendingContext} />
  }

  if (section === 'backup') {
    return <BackupDetailPending context={pendingContext} />
  }

  if (section === 'logs') {
    return <ProjectLogsPending context={pendingContext} />
  }

  if (section === 'deployments') {
    return <DeploymentsPending context={pendingContext} />
  }

  if (section === 'backups') {
    return <BackupsPending context={pendingContext} />
  }

  return <ProjectOverviewPending context={pendingContext} />
}

function ProjectOverviewPending({
  context,
}: {
  context: PendingProjectContext
}) {
  return (
    <div className="space-y-8" aria-label="Loading project overview">
      <ProjectHeadingPending context={context} />

      <section className="space-y-4">
        <SectionHeadingPending action label="Environments" />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 1 }, (_, index) => (
            <div className="h-28 rounded-xl border p-4" key={index}>
              <Skeleton className="mb-4 h-4 w-28" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeadingPending action label="Latest deployments" />
        <ListPending rows={4} />
        <div className="flex justify-end">
          <Skeleton className="h-8 w-32" />
        </div>
      </section>
    </div>
  )
}

function DeploymentsPending({ context }: { context: PendingProjectContext }) {
  return (
    <div className="space-y-8" aria-label="Loading deployments">
      <ProjectHeadingPending
        action
        context={context}
        crumbs={['Deployments']}
      />
      <section className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton className="h-8 w-32" key={index} />
          ))}
        </div>
        <ListPending rows={5} />
      </section>
    </div>
  )
}

function DeploymentDetailPending({
  context,
}: {
  context: PendingProjectContext
}) {
  return (
    <div className="space-y-8" aria-label="Loading deployment">
      <ProjectHeadingPending
        actions={2}
        context={context}
        crumbs={[
          'Deployments',
          context.deploymentId?.slice(0, 7) ?? 'Deployment',
        ]}
        monoLast
      />

      <section className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <MetadataItemPending textWidth="w-20" />
          <MetadataItemPending textWidth="w-8" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <MetadataItemPending dot textWidth="w-20" />
          <MetadataItemPending textWidth="w-10" />
          <MetadataItemPending textWidth="w-10" />
          <MetadataItemPending textWidth="w-40" />
        </div>
      </section>
      <section className="space-y-4">
        <DeploymentLogAreaPending />
        <div className="flex justify-end">
          <Skeleton className="h-7 w-20" />
        </div>
      </section>
    </div>
  )
}

function MetadataItemPending({
  dot = false,
  textWidth,
}: {
  dot?: boolean
  textWidth: string
}) {
  return (
    <div className="flex items-center gap-x-2">
      <Skeleton
        className={dot ? 'size-2 shrink-0 rounded-full' : 'size-4 shrink-0'}
      />
      <Skeleton className={`h-4 ${textWidth}`} />
    </div>
  )
}

function DeploymentLogAreaPending() {
  return (
    <div className="h-[500px] overflow-hidden rounded-lg border border-border p-2">
      {Array.from({ length: 15 }, (_, index) => (
        <LogLinePending index={index} key={index} />
      ))}
    </div>
  )
}

function ProjectLogsPending({ context }: { context: PendingProjectContext }) {
  return (
    <div className="space-y-8" aria-label="Loading project logs">
      <ProjectHeadingPending actions={1} context={context} crumbs={['Logs']} />
      <section>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-48" />
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton className="h-8 w-32" key={index} />
            ))}
          </div>
          <LogAreaPending />
        </div>
      </section>
    </div>
  )
}

function ProjectSettingsPending({
  context,
}: {
  context: PendingProjectContext
}) {
  return (
    <div className="space-y-8" aria-label="Loading project settings">
      <ProjectHeadingPending context={context} crumbs={['Project settings']} />
      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <div className="space-y-8">
          {[
            {
              bodyHeight: 'h-[23.5rem]',
              description:
                'General settings for the project including the Git repository.',
              rows: 4,
              title: 'General',
            },
            {
              bodyHeight: 'h-[47.5rem]',
              description:
                'Configure the Compose file, deployment commands, and health checks.',
              largeRows: 3,
              rows: 7,
              title: 'Build & Deploy',
            },
            {
              bodyHeight: 'h-[11.5rem]',
              description:
                'Deployments will be associated with the first environment with a matching branch pattern.',
              rows: 2,
              title: 'Environments',
            },
            {
              bodyHeight: 'h-40',
              description:
                'Variables available at build time and runtime. Changes will take effect after a new deployment.',
              rows: 2,
              title: 'Environment variables',
            },
            {
              bodyHeight: 'h-44',
              description:
                'Choose a default server, then override individual environments when needed.',
              rows: 2,
              title: 'Servers',
            },
            {
              bodyHeight: 'h-32',
              description:
                'Default routes apply to every environment. Environment routes add paths or override the default target for the same path.',
              rows: 1,
              title: 'Routes',
            },
            {
              bodyHeight: 'h-40',
              description:
                "Custom domain names associated with this project's environments.",
              rows: 2,
              title: 'Domains',
            },
            {
              bodyHeight: 'h-8',
              compact: true,
              description:
                'Permanently delete the project and all of its configuration, environments and deployments.',
              rows: 1,
              title: 'Danger',
            },
          ].map((config, index) => (
            <SettingsCardPending {...config} footer={index < 7} key={index} />
          ))}
        </div>
        <SectionNavigation
          className="hidden lg:flex"
          items={projectSettingsNavigationItems}
        />
      </div>
    </div>
  )
}

function BackupsPending({ context }: { context: PendingProjectContext }) {
  return (
    <div className="space-y-8" aria-label="Loading backups">
      <ProjectHeadingPending context={context} crumbs={['Backups']} />
      <div className="space-y-8">
        <section className="space-y-4">
          <SectionHeadingPending action label="Backup policies" />
          <ListPending rows={3} />
        </section>
        <section className="space-y-4">
          <SectionHeadingPending action label="Backup runs" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-32" />
          </div>
          <ListPending rows={5} />
        </section>
      </div>
    </div>
  )
}

function BackupDetailPending({ context }: { context: PendingProjectContext }) {
  return (
    <div className="space-y-8" aria-label="Loading backup policy">
      <ProjectHeadingPending context={context} crumbs={['Backups', null]} />
      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <div className="space-y-8">
          {[
            {
              bodyHeight: 'h-80',
              description:
                'Name, environment, and schedule for this backup policy.',
              rows: 4,
              title: 'General',
            },
            {
              bodyHeight: 'h-[35rem]',
              description: 'Upload backup artifacts to remote object storage.',
              rows: 6,
              title: 'Remote backups',
            },
            {
              bodyHeight: 'h-72',
              description:
                'Limits retained local and remote backup generations by count, age, and storage.',
              rows: 4,
              title: 'Retention',
            },
            {
              bodyHeight: 'h-56',
              description:
                'Archive named Compose volumes for this environment.',
              rows: 3,
              title: 'Volume backups',
            },
            {
              bodyHeight: 'h-64',
              description:
                'Run database dump commands before the archive is uploaded.',
              rows: 3,
              title: 'Database dumps',
            },
            {
              bodyHeight: 'h-8',
              compact: true,
              description:
                'Delete this backup policy. Existing backup runs are kept.',
              rows: 1,
              title: 'Danger',
            },
          ].map((config, index) => (
            <SettingsCardPending {...config} footer={index < 5} key={index} />
          ))}
        </div>
        <SectionNavigation
          className="hidden lg:flex"
          items={backupNavigationItems}
        />
      </div>
    </div>
  )
}

function ProjectHeadingPending({
  actions = 0,
  action = false,
  context,
  crumbs = [],
  monoLast = false,
}: {
  actions?: number
  action?: boolean
  context: PendingProjectContext
  crumbs?: Array<string | null>
  monoLast?: boolean
}) {
  const actionCount = actions || (action ? 1 : 0)

  return (
    <header className="flex min-h-10 items-center justify-between gap-4">
      <h1 className="flex min-w-0 items-center gap-x-3 text-2xl font-medium">
        <a
          className="shrink-0"
          href={`/${context.teamSlug}/projects/${context.projectName}`}
        >
          <ResourceAvatar
            name={context.projectName}
            src={context.avatarUrl ?? undefined}
            color={context.color}
            size="md"
          />
        </a>
        {crumbs.length === 0 ? (
          <span className="truncate">{context.projectName}</span>
        ) : (
          crumbs.map((crumb, index) => (
            <span className="contents" key={`${crumb ?? 'loading'}:${index}`}>
              <span className="text-muted-foreground/25 font-normal">/</span>
              {crumb ? (
                <span
                  className={
                    monoLast && index === crumbs.length - 1
                      ? 'truncate font-mono'
                      : 'truncate'
                  }
                >
                  {crumb}
                </span>
              ) : (
                <Skeleton className="h-8 w-32" />
              )}
            </span>
          ))
        )}
      </h1>
      {actionCount > 0 ? (
        <div className="flex gap-2">
          {Array.from({ length: actionCount }, (_, index) => (
            <Skeleton
              className={index === 0 ? 'h-8 w-20 shrink-0' : 'size-8 shrink-0'}
              key={index}
            />
          ))}
        </div>
      ) : null}
    </header>
  )
}

function SectionHeadingPending({
  action = false,
  label,
}: {
  action?: boolean
  label: string
}) {
  return (
    <div className="flex h-8 items-center justify-between gap-4">
      <h2 className="text-base font-medium">{label}</h2>
      {action ? <Skeleton className="h-8 w-36" /> : null}
    </div>
  )
}

function ListPending({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      {Array.from({ length: rows }, (_, index) => (
        <div
          className="flex h-11 items-center gap-4 border-b px-4 last:border-b-0"
          key={index}
        >
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 min-w-20 flex-1" />
          <Skeleton className="size-8 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function LogAreaPending() {
  return (
    <div className="h-[500px] overflow-hidden rounded-lg border p-2">
      {Array.from({ length: 15 }, (_, index) => (
        <LogLinePending badge index={index} key={index} />
      ))}
    </div>
  )
}

function LogLinePending({
  badge = false,
  index,
}: {
  badge?: boolean
  index: number
}) {
  return (
    <div className="flex items-start gap-x-4 rounded-md px-2 py-1.5">
      <Skeleton className={badge ? 'h-5 w-28 shrink-0' : 'h-5 w-16 shrink-0'} />
      {badge ? <Skeleton className="h-5 w-16 shrink-0" /> : null}
      <div className="min-w-0 flex-1">
        <Skeleton
          className="h-5"
          style={{ width: `${42 + ((index * 11) % 47)}%` }}
        />
      </div>
    </div>
  )
}

function SettingsCardPending({
  bodyHeight,
  compact = false,
  description,
  footer = true,
  largeRows = 0,
  rows,
  title,
}: {
  bodyHeight: string
  compact?: boolean
  description: string
  footer?: boolean
  largeRows?: number
  rows: number
  title: string
}) {
  return (
    <Card>
      <CardHeader className="space-y-2 border-b">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className={`${bodyHeight} overflow-hidden`}>
        {compact ? (
          <Skeleton className="h-8 w-36" />
        ) : (
          <div className="space-y-6">
            {Array.from({ length: rows }, (_, index) => (
              <div className="space-y-2" key={index}>
                <Skeleton
                  className={index % 3 === 1 ? 'h-4 w-32' : 'h-4 w-24'}
                />
                <Skeleton
                  className={index < largeRows ? 'h-16 w-full' : 'h-8 w-full'}
                />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {footer ? (
        <CardFooter className="justify-end gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
        </CardFooter>
      ) : null}
    </Card>
  )
}
