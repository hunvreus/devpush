import { describe, expect, it } from 'vitest'

import { calculateHeartbeatUptime } from '@/server/servers/monitoring'

describe('calculateHeartbeatUptime', () => {
  it('returns null when the server has no measurable window', () => {
    const now = new Date('2026-06-28T10:00:00.000Z')

    expect(
      calculateHeartbeatUptime({
        createdAt: now,
        heartbeats: [],
        now,
      }),
    ).toBeNull()
  })

  it('counts each heartbeat as connected until the disconnect threshold', () => {
    const now = new Date('2026-06-28T10:00:00.000Z')
    const createdAt = new Date('2026-06-28T09:50:00.000Z')

    expect(
      calculateHeartbeatUptime({
        createdAt,
        heartbeats: [
          { observedAt: new Date('2026-06-28T09:50:00.000Z') },
          { observedAt: new Date('2026-06-28T09:52:00.000Z') },
        ],
        now,
      }),
    ).toBeCloseTo(40)
  })

  it('merges overlapping heartbeat coverage', () => {
    const now = new Date('2026-06-28T10:00:00.000Z')
    const createdAt = new Date('2026-06-28T09:56:00.000Z')

    expect(
      calculateHeartbeatUptime({
        createdAt,
        heartbeats: [
          { observedAt: new Date('2026-06-28T09:56:00.000Z') },
          { observedAt: new Date('2026-06-28T09:57:00.000Z') },
        ],
        now,
      }),
    ).toBeCloseTo(75)
  })
})
