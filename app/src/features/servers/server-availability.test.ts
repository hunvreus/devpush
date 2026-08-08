import { describe, expect, it } from 'vitest'

import { getServerAvailabilityNotice } from './server-availability'

describe('getServerAvailabilityNotice', () => {
  it('returns no notice when every server is connected', () => {
    expect(
      getServerAvailabilityNotice([
        { id: 'one', name: 'One', status: 'connected' },
      ]),
    ).toBeNull()
  })

  it('links a disconnected notice to the affected server', () => {
    expect(
      getServerAvailabilityNotice([
        { id: 'one', name: 'One', status: 'connected' },
        { id: 'two', name: 'Two', status: 'disconnected' },
      ]),
    ).toEqual({
      title: '1 server is disconnected',
      description: 'Two is disconnected.',
      targetServerId: 'two',
    })
  })
})
