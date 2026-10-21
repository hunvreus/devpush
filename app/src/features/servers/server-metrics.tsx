import { useQuery } from '@tanstack/react-query'
import { serverMetricHistoryQueryOptions } from '@/lib/server-context-query'
import { ServerMetricChart } from './server-metric-chart'
import {
  ServerMetricsPending,
  ServerMetricsEmpty,
} from './server-metrics-pending'
import {
  formatPercent,
  formatByteRatio,
  formatNetworkSummary,
  formatBytePercent,
  formatBytesPerSecond,
} from './server-metric-format'

import { Button } from '@/components/ui/button'
import type { ServerMetricsSample } from '@/server/servers/monitoring'

export function ServerMetrics({
  serverId,
  teamSlug,
  latestMetrics,
}: {
  serverId: string
  teamSlug: string
  latestMetrics: ServerMetricsSample | null
}) {
  const history = useQuery({
    ...serverMetricHistoryQueryOptions({ serverId, teamSlug }),
    enabled: latestMetrics !== null,
  })
  if (!latestMetrics) return <ServerMetricsEmpty />
  if (!history.data) {
    if (history.isError)
      return (
        <div role="alert">
          Unable to load metric history.{' '}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void history.refetch()}
          >
            Retry
          </Button>
        </div>
      )
    return <ServerMetricsPending latestMetrics={latestMetrics} />
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ServerMetricChart
        domain={[0, 100]}
        label="CPU usage"
        latestValue={formatPercent(latestMetrics.cpuPercent)}
        points={history.data.points}
        formatValue={formatPercent}
        series={[
          {
            key: 'cpu',
            label: 'CPU',
            color: 'var(--chart-1)',
            getValue: (sample) => sample.cpuPercent,
          },
        ]}
        window={history.data.window}
      />
      <ServerMetricChart
        domain={[0, 100]}
        label="Memory usage"
        latestValue={formatByteRatio(
          latestMetrics.memoryUsedBytes,
          latestMetrics.memoryTotalBytes,
        )}
        points={history.data.points}
        formatValue={formatPercent}
        series={[
          {
            key: 'memory',
            label: 'Memory',
            color: 'var(--chart-1)',
            getValue: (sample) =>
              formatBytePercent(
                sample.memoryUsedBytes,
                sample.memoryTotalBytes,
              ),
          },
        ]}
        window={history.data.window}
      />
      <ServerMetricChart
        domain={[0, 100]}
        label="Disk usage"
        latestValue={formatByteRatio(
          latestMetrics.diskUsedBytes,
          latestMetrics.diskTotalBytes,
        )}
        points={history.data.points}
        formatValue={formatPercent}
        series={[
          {
            key: 'disk',
            label: 'Disk',
            color: 'var(--chart-1)',
            getValue: (sample) =>
              formatBytePercent(sample.diskUsedBytes, sample.diskTotalBytes),
          },
        ]}
        window={history.data.window}
      />
      <ServerMetricChart
        label="Network traffic"
        latestValue={formatNetworkSummary(
          latestMetrics.networkReceiveBytesPerSecond,
          latestMetrics.networkTransmitBytesPerSecond,
        )}
        points={history.data.points}
        formatValue={formatBytesPerSecond}
        series={[
          {
            key: 'received',
            label: 'Received',
            color: 'var(--chart-1)',
            getValue: (sample) => sample.networkReceiveBytesPerSecond,
          },
          {
            key: 'sent',
            label: 'Sent',
            color: 'var(--chart-2)',
            getValue: (sample) => sample.networkTransmitBytesPerSecond,
          },
        ]}
        window={history.data.window}
      />
    </div>
  )
}
