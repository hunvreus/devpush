import { Skeleton } from '@/components/ui/skeleton'
import { SectionNavigationPending } from '@/components/section-navigation'

export type ProjectPendingSection =
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
  if (section === 'settings') {
    return <ProjectSettingsPending />
  }

  if (section === 'deployment') {
    return <DeploymentDetailPending />
  }

  if (section === 'logs') {
    return <ProjectLogsPending />
  }

  if (section === 'deployments') {
    return <DeploymentsPending />
  }

  if (section === 'backups') {
    return <BackupsPending />
  }

  return <ProjectOverviewPending />
}

function ProjectOverviewPending() {
  return (
    <div className="space-y-8" aria-label="Loading project overview">
      <ProjectHeadingPending />

      <section className="space-y-4">
        <SectionHeadingPending action />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 2 }, (_, index) => (
            <div className="h-32 rounded-xl border p-4" key={index}>
              <Skeleton className="mb-5 h-4 w-28" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeadingPending action />
        <ListPending rows={4} />
        <div className="flex justify-end">
          <Skeleton className="h-8 w-32" />
        </div>
      </section>
    </div>
  )
}

function DeploymentsPending() {
  return (
    <div className="space-y-8" aria-label="Loading deployments">
      <ProjectHeadingPending action />
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

function DeploymentDetailPending() {
  return (
    <div className="space-y-8" aria-label="Loading deployment">
      <ProjectHeadingPending action />
      <section className="space-y-4">
        <div className="flex flex-wrap gap-8">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton className="h-4 w-28" key={index} />
          ))}
        </div>
        <div className="flex flex-wrap gap-8">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton className="h-4 w-36" key={index} />
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <LogAreaPending />
        <div className="flex justify-end">
          <Skeleton className="h-8 w-24" />
        </div>
      </section>
    </div>
  )
}

function ProjectLogsPending() {
  return (
    <div className="space-y-8" aria-label="Loading project logs">
      <ProjectHeadingPending action />
      <section>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-48" />
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton className="h-8 w-32" key={index} />
            ))}
          </div>
          <LogAreaPending />
        </div>
      </section>
    </div>
  )
}

function ProjectSettingsPending() {
  return (
    <div className="space-y-8" aria-label="Loading project settings">
      <ProjectHeadingPending />
      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <div className="space-y-8">
          <SettingsCardPending bodyHeight="h-72" />
          <SettingsCardPending bodyHeight="h-80" />
          <SettingsCardPending bodyHeight="h-56" />
        </div>
        <SectionNavigationPending className="hidden lg:flex" count={8} />
      </div>
    </div>
  )
}

function BackupsPending() {
  return (
    <div className="space-y-8" aria-label="Loading backups">
      <ProjectHeadingPending action />
      <div className="space-y-8">
        <SettingsCardPending bodyHeight="h-56" />
        <ListPending rows={5} />
      </div>
    </div>
  )
}

function ProjectHeadingPending({ action = false }: { action?: boolean }) {
  return (
    <div className="flex h-12 items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Skeleton className="size-12 shrink-0 rounded-lg" />
        <Skeleton className="h-8 w-56 max-w-full" />
      </div>
      {action ? <Skeleton className="h-8 w-24 shrink-0" /> : null}
    </div>
  )
}

function SectionHeadingPending({ action = false }: { action?: boolean }) {
  return (
    <div className="flex h-8 items-center justify-between gap-4">
      <Skeleton className="h-5 w-36" />
      {action ? <Skeleton className="h-8 w-36" /> : null}
    </div>
  )
}

function ListPending({ rows }: { rows: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          className="flex h-12 items-center gap-4 border border-b-0 px-4 first:rounded-t-xl last:rounded-b-xl last:border-b"
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
    <div className="h-[500px] rounded-lg border p-4">
      <div className="space-y-3">
        {Array.from({ length: 8 }, (_, index) => (
          <div className="flex gap-4" key={index}>
            <Skeleton className="h-4 w-20 shrink-0" />
            <Skeleton className="h-4 w-16 shrink-0" />
            <Skeleton className="h-4" style={{ width: `${45 + index * 4}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsCardPending({ bodyHeight }: { bodyHeight: string }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="space-y-2 border-b p-6">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className={`p-6 ${bodyHeight}`}>
        <div className="space-y-6">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </div>
      <div className="flex h-16 items-center justify-end gap-2 border-t px-6">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
      </div>
    </div>
  )
}
