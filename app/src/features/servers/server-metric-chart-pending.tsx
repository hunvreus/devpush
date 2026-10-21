import { Skeleton } from '@/components/ui/skeleton'
import { LoaderIcon } from 'lucide-react'

export function ServerMetricChartPending({
  label,
  latestValue,
}: {
  label: string
  latestValue?: string
}) {
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-busy="true">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
        {latestValue === undefined ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <p className="font-mono text-sm font-medium tabular-nums">
            {latestValue}
          </p>
        )}
      </div>
      <MetricChartLoading />
    </section>
  )
}

export function MetricChartLoading() {
  return (
    <div
      role="status"
      className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <LoaderIcon className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      <span>Loading data…</span>
    </div>
  )
}
