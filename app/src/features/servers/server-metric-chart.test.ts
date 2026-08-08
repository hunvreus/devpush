import { describe, expect, test } from 'vitest'

import { formatMetricTooltipTimestamp } from './server-metric-chart'

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
})
