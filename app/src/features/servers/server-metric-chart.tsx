import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import type { ServerMetricsSample } from '@/server/servers/monitoring'

const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
})
const timestampFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})

type TooltipPayload = ReadonlyArray<{
  payload?: unknown
}>

export function formatMetricTooltipTimestamp(payload: TooltipPayload) {
  const point = payload.at(0)?.payload
  if (!point || typeof point !== 'object' || !('timestamp' in point)) {
    return null
  }

  const timestamp = Reflect.get(point, 'timestamp')
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return null
  }

  return timestampFormatter.format(timestamp)
}

type MetricSeries = {
  key: string
  label: string
  color: string
  getValue: (sample: ServerMetricsSample) => number | null
}

export function ServerMetricChart({
  domain = [0, 'auto'],
  formatValue,
  label,
  latestValue,
  points,
  series,
  window,
}: {
  domain?: [number | 'auto', number | 'auto']
  formatValue: (value: number | null) => string
  label: string
  latestValue: string
  points: Array<ServerMetricsSample>
  series: Array<MetricSeries>
  window: {
    startedAt: string
    endedAt: string
  }
}) {
  const data = points.flatMap((sample) => {
    const timestamp = new Date(sample.observedAt).getTime()
    if (!Number.isFinite(timestamp)) {
      return []
    }
    return [
      Object.fromEntries([
        ['timestamp', timestamp],
        ...series.map((item) => [item.key, item.getValue(sample)]),
      ]),
    ]
  })
  const valueCount = data.filter((point) =>
    series.some((item) => point[item.key] !== null),
  ).length
  const config = Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  ) satisfies ChartConfig

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
        <p className="text-sm font-medium tabular-nums">{latestValue}</p>
      </div>
      {valueCount > 1 ? (
        <ChartContainer config={config} className="h-40 w-full aspect-auto">
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{ top: 4, right: 2, bottom: 0, left: 2 }}
            syncId="server-metrics"
            syncMethod="index"
          >
            <CartesianGrid vertical={false} strokeOpacity={0.35} />
            <XAxis
              allowDataOverflow
              axisLine={false}
              dataKey="timestamp"
              domain={[
                new Date(window.startedAt).getTime(),
                new Date(window.endedAt).getTime(),
              ]}
              minTickGap={72}
              scale="time"
              tickCount={3}
              tickFormatter={(value: number) => timeFormatter.format(value)}
              tickLine={false}
              tickMargin={8}
              type="number"
            />
            <YAxis hide domain={domain} type="number" />
            <ChartTooltip
              filterNull
              cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.5 }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    formatMetricTooltipTimestamp(payload)
                  }
                  formatter={(value, name, item) => (
                    <>
                      <span
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="flex min-w-36 flex-1 items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          {config[String(name)].label}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatValue(Number(value))}
                        </span>
                      </div>
                    </>
                  )}
                />
              }
            />
            {series.map((item) => (
              <Area
                key={item.key}
                activeDot={{ r: 3, strokeWidth: 0 }}
                connectNulls={false}
                dataKey={item.key}
                fill={`var(--color-${item.key})`}
                fillOpacity={0.12}
                isAnimationActive={false}
                stroke={`var(--color-${item.key})`}
                strokeWidth={1.5}
                type="linear"
              />
            ))}
          </AreaChart>
        </ChartContainer>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {valueCount === 0 ? 'Not reported by agent' : 'Collecting history'}
        </div>
      )}
    </section>
  )
}
