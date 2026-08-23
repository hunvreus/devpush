import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import {
  formatMetricTooltipTimestamp,
  ServerMetricChart,
} from './server-metric-chart'
import type { ServerMetricsSample } from '@/server/servers/monitoring'

const sample = {
  cpuPercent: 12,
  load1: null,
  memoryUsedBytes: null,
  memoryTotalBytes: null,
  diskUsedBytes: null,
  diskTotalBytes: null,
  networkReceiveBytesPerSecond: null,
  networkTransmitBytesPerSecond: null,
  diskReadBytesPerSecond: null,
  diskWriteBytesPerSecond: null,
} satisfies Omit<ServerMetricsSample, 'observedAt'>

describe('formatMetricTooltipTimestamp', () => {
  test('formats the timestamp stored on the hovered data point', () => {
    expect(
      formatMetricTooltipTimestamp([
        { payload: { timestamp: Date.UTC(2026, 7, 2, 19, 55, 30) } },
      ]),
    ).not.toBeNull()
  })

  test('does not throw for a missing or invalid tooltip timestamp', () => {
    expect(formatMetricTooltipTimestamp([])).toBeNull()
    expect(
      formatMetricTooltipTimestamp([{ payload: { timestamp: null } }]),
    ).toBeNull()
    expect(
      formatMetricTooltipTimestamp([{ payload: { timestamp: Number.NaN } }]),
    ).toBeNull()
  })

  test('renders a chart loading state before client hydration', () => {
    const html = renderToStaticMarkup(
      createElement(ServerMetricChart, {
        label: 'CPU usage',
        latestValue: '12%',
        points: [
          { ...sample, observedAt: '2026-08-22T00:00:00.000Z' },
          { ...sample, observedAt: '2026-08-22T00:01:00.000Z' },
        ],
        formatValue: (value) => `${value}%`,
        series: [
          {
            key: 'cpu',
            label: 'CPU',
            color: 'var(--chart-1)',
            getValue: (point) => point.cpuPercent,
          },
        ],
        window: {
          startedAt: '2026-08-22T00:00:00.000Z',
          endedAt: '2026-08-22T00:01:00.000Z',
        },
      }),
    )

    expect(html).toContain('Loading data…')
    expect(html).toContain('animate-spin')
    expect(html).toContain('role="status"')
  })
})
