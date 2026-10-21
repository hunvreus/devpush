import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { ServerMetricChartPending } from './server-metric-chart-pending'
import {
  formatPercent,
  formatByteRatio,
  formatNetworkSummary,
} from './server-metric-format'
import type { ServerMetricsSample } from '@/server/servers/monitoring'

export function ServerMetricsPending({
  latestMetrics,
}: {
  latestMetrics: ServerMetricsSample | null
}) {
  const metrics = [
    {
      label: 'CPU usage',
      latestValue: latestMetrics
        ? formatPercent(latestMetrics.cpuPercent)
        : undefined,
    },
    {
      label: 'Memory usage',
      latestValue: latestMetrics
        ? formatByteRatio(
            latestMetrics.memoryUsedBytes,
            latestMetrics.memoryTotalBytes,
          )
        : undefined,
    },
    {
      label: 'Disk usage',
      latestValue: latestMetrics
        ? formatByteRatio(
            latestMetrics.diskUsedBytes,
            latestMetrics.diskTotalBytes,
          )
        : undefined,
    },
    {
      label: 'Network traffic',
      latestValue: latestMetrics
        ? formatNetworkSummary(
            latestMetrics.networkReceiveBytesPerSecond,
            latestMetrics.networkTransmitBytesPerSecond,
          )
        : undefined,
    },
  ]
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {metrics.map((metric) => (
        <ServerMetricChartPending key={metric.label} {...metric} />
      ))}
    </div>
  )
}

export function ServerMetricsEmpty() {
  return (
    <Empty className="min-h-40 border">
      <EmptyHeader>
        <EmptyTitle>No metrics reported yet.</EmptyTitle>
        <EmptyDescription>
          Metrics will appear after the agent reports host data.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
