import { describe, expect, it } from 'vitest'

import {
  calculateHeartbeatAvailability,
  insertMetricGaps,
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
