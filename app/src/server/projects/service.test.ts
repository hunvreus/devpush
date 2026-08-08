import { describe, expect, test } from 'vitest'

import { buildDefaultHostForProject } from './service'

describe('buildDefaultHostForProject', () => {
  test('uses nip.io when the selected server has a public IPv4 address', () => {
    expect(
      buildDefaultHostForProject({
        projectName: 'my-app',
        serverPublicAddress: '167.11.3.44',
      }),
    ).toBe('my-app-167-11-3-44.nip.io')
  })

  test('uses nip.io for private IPv4 addresses', () => {
    expect(
      buildDefaultHostForProject({
        projectName: 'my-app',
        serverPublicAddress: '192.168.1.10',
      }),
    ).toBe('my-app-192-168-1-10.nip.io')
  })

  test('uses the local control-plane address when no IPv4 is reported', () => {
    expect(
      buildDefaultHostForProject({
        projectName: 'my-app',
        serverPublicAddress: '2001:db8::1',
      }),
    ).toBe('my-app-127-0-0-1.nip.io')
  })

  test('keeps the generated DNS label within 63 characters', () => {
    const hostname = buildDefaultHostForProject({
      projectName: 'a'.repeat(100),
      serverPublicAddress: '192.168.100.200',
    })

    expect(hostname.split('.')[0]).toHaveLength(63)
    expect(hostname).toMatch(/-192-168-100-200\.nip\.io$/)
  })
})
