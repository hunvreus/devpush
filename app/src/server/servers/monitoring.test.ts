import { describe, expect, it } from 'vitest'

import {
  calculateHeartbeatAvailability,
  insertMetricGaps,
  downsampleServerMetricSeries,
} from '@/server/servers/monitoring'

describe('calculateHeartbeatAvailability', () => {
  it('returns no availability when the server has no measurable window', () => {
    const now = new Date('2026-06-28T10:00:00.000Z')

    expect(
      calculateHeartbeatAvailability({
        availabilityWindows: [{ startedAt: now, endedAt: null }],
        heartbeats: [],
        now,
      }),
    ).toEqual({ percent: null, windowMs: 0 })
  })

  it('counts each heartbeat as connected until the disconnect threshold', () => {
    const now = new Date('2026-06-28T10:00:00.000Z')
    const createdAt = new Date('2026-06-28T09:50:00.000Z')

    expect(
      calculateHeartbeatAvailability({
        availabilityWindows: [{ startedAt: createdAt, endedAt: null }],
        heartbeats: [
          { observedAt: new Date('2026-06-28T09:50:00.000Z') },
          { observedAt: new Date('2026-06-28T09:52:00.000Z') },
        ],
        now,
      }),
    ).toEqual({ percent: 40, windowMs: 10 * 60_000 })
  })

  it('merges overlapping heartbeat coverage', () => {
    const now = new Date('2026-06-28T10:00:00.000Z')
    const createdAt = new Date('2026-06-28T09:56:00.000Z')

    expect(
      calculateHeartbeatAvailability({
        availabilityWindows: [{ startedAt: createdAt, endedAt: null }],
        heartbeats: [
          { observedAt: new Date('2026-06-28T09:56:00.000Z') },
          { observedAt: new Date('2026-06-28T09:57:00.000Z') },
        ],
        now,
      }),
    ).toEqual({ percent: 75, windowMs: 4 * 60_000 })
  })

  it('excludes disabled periods from the availability denominator', () => {
    const now = new Date('2026-06-28T10:00:00.000Z')

    expect(
      calculateHeartbeatAvailability({
        availabilityWindows: [
          {
            startedAt: new Date('2026-06-28T09:50:00.000Z'),
            endedAt: new Date('2026-06-28T09:54:00.000Z'),
          },
          {
            startedAt: new Date('2026-06-28T09:58:00.000Z'),
            endedAt: null,
          },
        ],
        heartbeats: [
          { observedAt: new Date('2026-06-28T09:50:00.000Z') },
          { observedAt: new Date('2026-06-28T09:58:00.000Z') },
        ],
        now,
      }),
    ).toEqual({
      percent: expect.closeTo(66.67, 1),
      windowMs: 6 * 60_000,
    })
  })
})

describe('insertMetricGaps', () => {
  const sample = (observedAt: string, cpuPercent: number) => ({
    observedAt,
    cpuPercent,
    load1: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    diskUsedBytes: null,
    diskTotalBytes: null,
    networkReceiveBytesPerSecond: null,
    networkTransmitBytesPerSecond: null,
    diskReadBytesPerSecond: null,
    diskWriteBytesPerSecond: null,
  })

  it('inserts a null point when collection pauses', () => {
    const points = insertMetricGaps(
      [
        sample('2026-06-28T09:50:00.000Z', 10),
        sample('2026-06-28T09:53:00.000Z', 20),
      ],
      75_000,
    )

    expect(points).toHaveLength(3)
    expect(points[1]).toMatchObject({
      observedAt: '2026-06-28T09:51:30.000Z',
      cpuPercent: null,
    })
  })

  it('breaks the line across a disabled interval shorter than the sampling gap', () => {
    const points = insertMetricGaps(
      [
        sample('2026-06-28T09:50:00.000Z', 10),
        sample('2026-06-28T09:51:00.000Z', 20),
      ],
      75_000,
      [
        {
          startedAt: new Date('2026-06-28T09:49:00.000Z'),
          endedAt: new Date('2026-06-28T09:50:20.000Z'),
        },
        {
          startedAt: new Date('2026-06-28T09:50:40.000Z'),
          endedAt: null,
        },
      ],
    )

    expect(points).toHaveLength(3)
    expect(points[1]).toMatchObject({
      observedAt: '2026-06-28T09:50:30.000Z',
      cpuPercent: null,
    })
  })
})

describe('chart downsampling', () => {
  const sample = (index: number) => ({
    observedAt: new Date(index * 30_000).toISOString(),
    cpuPercent: 10,
    load1: null,
    memoryUsedBytes: 100,
    memoryTotalBytes: 200,
    diskUsedBytes: 100,
    diskTotalBytes: 200,
    networkReceiveBytesPerSecond: 10,
    networkTransmitBytesPerSecond: 20,
    diskReadBytesPerSecond: null,
    diskWriteBytesPerSecond: null,
  })
  it('reduces a full day while retaining endpoints and independent CPU/network peaks', () => {
    const samples = Array.from({ length: 2880 }, (_, index) => sample(index))
    samples[123]!.cpuPercent = 99
    samples[129]!.networkReceiveBytesPerSecond = 9999
    samples[131]!.memoryUsedBytes = 199
    const result = downsampleServerMetricSeries(samples)
    expect(result.length).toBeLessThanOrEqual(600)
    expect(result[0]).toEqual(samples[0])
    expect(result.at(-1)).toEqual(samples.at(-1))
    for (const index of [123, 129, 131])
      expect(result).toContain(samples[index])
  })
  it('retains both sides of outages and missing individual metrics', () => {
    const samples = Array.from({ length: 2880 }, (_, index) => sample(index))
    const gap = {
      ...samples[141]!,
      cpuPercent: null,
      memoryUsedBytes: null,
      memoryTotalBytes: null,
      diskUsedBytes: null,
      diskTotalBytes: null,
      networkReceiveBytesPerSecond: null,
      networkTransmitBytesPerSecond: null,
    }
    const partial = { ...samples[160]!, cpuPercent: null }
    const source = [
      ...samples.slice(0, 141),
      gap,
      ...samples.slice(142, 160),
      partial,
      ...samples.slice(161),
    ]
    const result = downsampleServerMetricSeries(source)
    for (const index of [140, 141, 142, 159, 160, 161])
      expect(result).toContain(source[index])
    expect(downsampleServerMetricSeries([sample(0)])).toEqual([sample(0)])
  })
})
