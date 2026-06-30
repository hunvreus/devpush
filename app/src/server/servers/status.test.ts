import { describe, expect, it } from 'vitest'

import { getEffectiveServerStatus } from '@/server/servers/status'

describe('getEffectiveServerStatus', () => {
  const now = new Date('2026-06-19T12:00:00.000Z')

  it('keeps non-connected statuses unchanged', () => {
    expect(
      getEffectiveServerStatus({ status: 'pending', lastSeenAt: null, now }),
    ).toBe('pending')
    expect(
      getEffectiveServerStatus({ status: 'disabled', lastSeenAt: null, now }),
    ).toBe('disabled')
  })

  it('marks connected servers without a heartbeat as disconnected', () => {
    expect(
      getEffectiveServerStatus({ status: 'connected', lastSeenAt: null, now }),
    ).toBe('disconnected')
  })

  it('keeps recently seen connected servers connected', () => {
    expect(
      getEffectiveServerStatus({
        status: 'connected',
        lastSeenAt: new Date('2026-06-19T11:59:00.000Z'),
        now,
      }),
    ).toBe('connected')
  })

  it('marks stale connected servers disconnected', () => {
    expect(
      getEffectiveServerStatus({
        status: 'connected',
        lastSeenAt: new Date('2026-06-19T11:57:00.000Z'),
        now,
      }),
    ).toBe('disconnected')
  })
})
