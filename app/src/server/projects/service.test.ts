import { describe, expect, test } from 'vitest'

import { buildDefaultHostForProject } from './service'

describe('buildDefaultHostForProject', () => {
  test('uses nip.io when the selected server has a public IPv4 address', () => {
    expect(
      buildDefaultHostForProject({
        projectName: 'my-app',
        serverPublicAddress: '167.11.3.44',
      }),
    ).toBe('my-app.167-11-3-44.nip.io')
  })

  test('falls back to the configured app domain for private IPv4 addresses', () => {
    expect(
      buildDefaultHostForProject({
        projectName: 'my-app',
        serverPublicAddress: '192.168.1.10',
      }),
    ).toBe('my-app.devpush.app')
  })

  test('falls back to the configured app domain for non-IPv4 addresses', () => {
    expect(
      buildDefaultHostForProject({
        projectName: 'my-app',
        serverPublicAddress: '2001:db8::1',
      }),
    ).toBe('my-app.devpush.app')
  })
})
