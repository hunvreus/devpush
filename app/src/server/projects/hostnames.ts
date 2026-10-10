import { isIP } from 'node:net'
import { and, eq, ne } from 'drizzle-orm'

import { config } from '@/server/config'
import { db } from '@/server/db'
import { aliases, domains } from '@/server/db/schema'
import type { DeploymentConfig } from './deployment-config'

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '')

  return slug || 'project'
}

export function buildDefaultHostForProject({
  projectName,
  serverPublicAddress,
}: {
  projectName: string
  serverPublicAddress: string | null
}) {
  const address = resolveRoutingAddress(serverPublicAddress)
  if (isIP(address) === 6) {
    const label = normalizeIpv6(address).replaceAll(':', '-')
    return `${toNipPrefix(projectName, 63)}.${label}.nip.io`
  }
  const addressLabel = address.replaceAll('.', '-')
  const prefix = toNipPrefix(projectName, 63 - addressLabel.length - 1)

  return `${prefix}-${addressLabel}.nip.io`
}

function toNipPrefix(value: string, maxLength: number) {
  const normalized =
    value
      .toLowerCase()
      .replace(/[\s_.]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'app'

  if (normalized.length <= maxLength) {
    return normalized
  }

  const hash = stableHostHash(normalized)
  const remainingLength = maxLength - hash.length - 2
  const startLength = Math.ceil(remainingLength / 2)
  const endLength = Math.floor(remainingLength / 2)

  return `${normalized.slice(0, startLength)}-${hash}-${normalized.slice(-endLength)}`
}

function stableHostHash(value: string) {
  let hash = 2_166_136_261

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }

  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 7)
}

export function buildDefaultHostForEnvironment({
  environmentSlug,
  projectName,
  serverPublicAddress,
}: {
  environmentSlug: string
  projectName: string
  serverPublicAddress: string | null
}) {
  const hostSlug =
    environmentSlug === 'production'
      ? projectName
      : `${projectName}-env-${slugify(environmentSlug)}`

  return buildDefaultHostForProject({
    projectName: hostSlug,
    serverPublicAddress,
  })
}

export function buildDeploymentAliasHostname({
  deploymentId,
  projectName,
  serverPublicAddress,
}: {
  deploymentId: string
  projectName: string
  serverPublicAddress: string | null
}) {
  return buildDefaultHostForProject({
    projectName: `${deploymentId.slice(0, 7)}-${projectName}`,
    serverPublicAddress,
  })
}

export function buildBranchAliasHostname({
  branch,
  projectName,
  serverPublicAddress,
}: {
  branch: string
  projectName: string
  serverPublicAddress: string | null
}) {
  return buildDefaultHostForProject({
    projectName: `${projectName}-git-${slugify(branch)}`,
    serverPublicAddress,
  })
}

function disambiguateNipHostname(hostname: string, uniquenessKey: string) {
  const ipv6 = /^([a-z0-9-]+)\.([a-f0-9-]+)\.nip\.io$/.exec(hostname)
  if (ipv6 && isIP(ipv6[2]!.replaceAll('-', ':')) === 6) {
    return `${toNipPrefix(`${ipv6[1]}-${stableHostHash(uniquenessKey)}`, 63)}.${ipv6[2]}.nip.io`
  }
  const match = /^(.*)-(\d{1,3}(?:-\d{1,3}){3})\.nip\.io$/.exec(hostname)

  if (!match) {
    throw new Error(`Generated alias "${hostname}" is not a nip.io hostname.`)
  }

  const [, prefix = 'app', address = '127-0-0-1'] = match
  const maxPrefixLength = 63 - address.length - 1
  const resolvedPrefix = toNipPrefix(
    `${prefix}-${stableHostHash(uniquenessKey)}`,
    maxPrefixLength,
  )

  return `${resolvedPrefix}-${address}.nip.io`
}

export async function resolveAvailableAliasHostname({
  excludeAliasId,
  hostname,
  uniquenessKey,
}: {
  excludeAliasId?: string
  hostname: string
  uniquenessKey: string
}) {
  let candidate = hostname

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [aliasRows, domainRows] = await Promise.all([
      db
        .select({ id: aliases.id })
        .from(aliases)
        .where(
          and(
            eq(aliases.hostname, candidate),
            excludeAliasId ? ne(aliases.id, excludeAliasId) : undefined,
          ),
        )
        .limit(1),
      db
        .select({ id: domains.id })
        .from(domains)
        .where(eq(domains.hostname, candidate))
        .limit(1),
    ])

    if (aliasRows.length === 0 && domainRows.length === 0) {
      return candidate
    }

    candidate = disambiguateNipHostname(hostname, `${uniquenessKey}:${attempt}`)
  }

  throw new Error('Could not generate an available nip.io hostname.')
}

export function replaceDeploymentAliasRoutes({
  config: deploymentConfig,
  hostname,
  https,
  previousHostnames,
}: {
  config: DeploymentConfig
  hostname: string
  https: boolean
  previousHostnames: Array<string>
}): DeploymentConfig {
  const previous = new Set(previousHostnames)
  const stableRoutes = deploymentConfig.routes.filter(
    (route) => !previous.has(route.host),
  )
  const routeShapes = new Map<
    string,
    Omit<DeploymentConfig['routes'][number], 'host' | 'https'>
  >()

  for (const route of stableRoutes.length > 0
    ? stableRoutes
    : deploymentConfig.routes) {
    const { host: _host, https: _https, ...shape } = route
    const key = `${shape.service}:${shape.port}:${shape.path}:${shape.stripPrefix}`
    routeShapes.set(key, shape)
  }

  return {
    ...deploymentConfig,
    routes: [
      ...stableRoutes,
      ...Array.from(routeShapes.values(), (route) => ({
        ...route,
        host: hostname,
        https,
      })),
    ],
  }
}

function resolveRoutingAddress(value: string | null) {
  if (value && isIP(value)) {
    return value
  }

  const controlPlaneHost = new URL(config.DEVPUSH_BASE_URL).hostname

  if (controlPlaneHost === 'localhost' || controlPlaneHost === '127.0.0.1') {
    return '127.0.0.1'
  }

  throw new Error(
    'The assigned server has no valid IP address for generating its nip.io URL.',
  )
}

export function isIpv4Address(value: string) {
  const octets = value.split('.').map((part) => Number.parseInt(part, 10))

  return (
    octets.length === 4 &&
    octets.every(
      (octet, index) =>
        /^\d{1,3}$/.test(value.split('.')[index] ?? '') &&
        octet >= 0 &&
        octet <= 255,
    )
  )
}

export function generatedAliasUsesHttps(serverPublicAddress: string | null) {
  const value = resolveRoutingAddress(serverPublicAddress)
  if (isIP(value) === 6) {
    const normalized = normalizeIpv6(value)
    return !(
      normalized === '::' ||
      normalized === '::1' ||
      /^f[cd]/.test(normalized) ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:') ||
      normalized.startsWith('::ffff:')
    )
  }
  const octets = value.split('.').map((part) => Number.parseInt(part, 10))

  const [first = 0, second = 0] = octets

  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 0 && octets[2] === 2) ||
    (first === 198 && second === 51 && octets[2] === 100) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    (first === 192 && second === 168)
  )
}

function normalizeIpv6(value: string) {
  return new URL(`http://[${value}]`).hostname.slice(1, -1)
}
