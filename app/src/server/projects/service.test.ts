import { describe, expect, test } from 'vitest'

import {
  buildDefaultHostForProject,
  generatedAliasUsesHttps,
} from './hostnames'
import { verifyDomainAddress } from './settings'
import { parseComposeMetadata } from './compose-metadata'
import { getEffectiveProjectRoutes } from './mappers'

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

  test('uses IPv6 nip.io DNS instead of silently routing to localhost', () => {
    expect(
      buildDefaultHostForProject({
        projectName: 'my-app',
        serverPublicAddress: '2001:db8::1',
      }),
    ).toBe('my-app.2001-db8--1.nip.io')
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

describe('verifyDomainAddress', () => {
  test('accepts equivalent IPv6 AAAA addresses', async () => {
    await expect(
      verifyDomainAddress({
        hostname: 'app.example.com',
        expectedAddress: '2001:db8::1',
        resolveAddresses: async () => [
          '2001:0db8:0000:0000:0000:0000:0000:0001',
        ],
      }),
    ).resolves.toEqual({ verified: true, message: null })
  })

  test('accepts DNS that resolves to the assigned server', async () => {
    await expect(
      verifyDomainAddress({
        hostname: 'app.example.com',
        expectedAddress: '203.0.113.10',
        resolveAddresses: async () => ['203.0.113.10'],
      }),
    ).resolves.toEqual({ verified: true, message: null })
  })

  test('reports a mismatched DNS target', async () => {
    await expect(
      verifyDomainAddress({
        hostname: 'app.example.com',
        expectedAddress: '203.0.113.10',
        resolveAddresses: async () => ['203.0.113.11'],
      }),
    ).resolves.toEqual({
      verified: false,
      message: 'DNS resolves to 203.0.113.11; expected 203.0.113.10.',
    })
  })
})

describe('Compose routing metadata', () => {
  test('suggests the only service on internal port 80 and warns about publishing', () => {
    expect(
      parseComposeMetadata(`
services:
  web:
    image: nginx
    ports:
      - "8080:80"
  db:
    image: postgres
`),
    ).toMatchObject({
      suggestedRoute: {
        path: '/',
        service: 'web',
        port: 80,
        stripPrefix: false,
      },
      warnings: [expect.stringContaining('Published ports on web are ignored')],
    })
  })

  test('does not guess between multiple services without a port 80 declaration', () => {
    expect(
      parseComposeMetadata(`
services:
  web:
    image: app
  api:
    image: app
`),
    ).toMatchObject({ suggestedRoute: null })
  })

  test('suggests the only declared target even when the project has many services', () => {
    expect(
      parseComposeMetadata(`
services:
  web:
    image: app
    expose:
      - 5000
  worker:
    image: app
  db:
    image: postgres
  redis:
    image: redis
  mail:
    image: mailpit/mailpit
  scheduler:
    image: app
`),
    ).toMatchObject({
      suggestedRoute: {
        path: '/',
        service: 'web',
        port: 5000,
        stripPrefix: false,
      },
    })
  })

  test('prefers the only port 80 target when other ports are declared', () => {
    expect(
      parseComposeMetadata(`
services:
  web:
    image: nginx
    expose:
      - 80
  api:
    image: app
    expose:
      - 3000
  metrics:
    image: app
    expose:
      - 9090
`),
    ).toMatchObject({
      suggestedRoute: {
        path: '/',
        service: 'web',
        port: 80,
        stripPrefix: false,
      },
    })
  })

  test('does not infer a route from undeclared ports or ambiguous targets', () => {
    expect(
      parseComposeMetadata(`
services:
  web:
    image: app
`),
    ).toMatchObject({ suggestedRoute: null })

    expect(
      parseComposeMetadata(`
services:
  web:
    image: nginx
    expose:
      - 80
  admin:
    image: nginx
    expose:
      - 80
`),
    ).toMatchObject({ suggestedRoute: null })
  })

  test('ignores non-TCP port declarations when suggesting HTTP ingress', () => {
    expect(
      parseComposeMetadata(`
services:
  dns:
    image: dns
    expose:
      - 53/udp
`),
    ).toMatchObject({ suggestedRoute: null })
  })
})

describe('environment route inheritance', () => {
  test('inherits defaults and replaces matching paths for one environment', () => {
    expect(
      getEffectiveProjectRoutes(
        [
          { path: '/', service: 'web', port: 80, stripPrefix: false },
          { path: '/api', service: 'api', port: 3000, stripPrefix: true },
          {
            path: '/api',
            service: 'preview-api',
            port: 4000,
            stripPrefix: false,
            environmentId: 'staging',
          },
        ],
        'staging',
      ),
    ).toEqual([
      {
        path: '/',
        service: 'web',
        port: 80,
        stripPrefix: false,
        environmentId: undefined,
      },
      {
        path: '/api',
        service: 'preview-api',
        port: 4000,
        stripPrefix: false,
        environmentId: undefined,
      },
    ])
  })
})

test('public IPv6 aliases use HTTPS while local IPv6 uses HTTP', () => {
  expect(generatedAliasUsesHttps('2a01:4f8:1c16:500c::1')).toBe(true)
  for (const address of ['::1', '::', 'fd00::1', 'fe80::1', '2001:db8::1']) {
    expect(generatedAliasUsesHttps(address)).toBe(false)
  }
})

test('canonicalizes IPv6 and keeps every generated DNS label valid', () => {
  const host = buildDefaultHostForProject({
    projectName: 'a'.repeat(100),
    serverPublicAddress: '2A01:04F8:1C16:500C:0:0:0:1',
  })
  expect(host).toMatch(/\.2a01-4f8-1c16-500c--1\.nip\.io$/)
  expect(host.split('.').every((label) => label.length <= 63)).toBe(true)
})
