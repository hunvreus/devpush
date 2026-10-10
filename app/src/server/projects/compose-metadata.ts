import { parse as parseYaml } from 'yaml'

export type ProjectComposeMetadata = {
  services: Array<string>
  volumes: Array<string>
  warnings: Array<string>
  suggestedRoute: {
    path: string
    service: string
    port: number
    stripPrefix: boolean
  } | null
}

export function parseComposeMetadata(
  composeText: string,
): ProjectComposeMetadata {
  const document = parseYaml(composeText)
  const root = isRecord(document) ? document : {}
  const services = isRecord(root.services)
    ? Object.keys(root.services).filter(Boolean).sort()
    : []
  const volumes = new Set<string>()
  const warnings = new Set<string>()
  const routeTargets = new Map<string, { service: string; port: number }>()

  if (isRecord(root.volumes)) {
    for (const volumeName of Object.keys(root.volumes)) {
      if (volumeName) {
        volumes.add(volumeName)
      }
    }
  }

  if (isRecord(root.services)) {
    for (const [serviceName, service] of Object.entries(root.services)) {
      if (
        isRecord(service) &&
        Array.isArray(service.ports) &&
        service.ports.length > 0
      ) {
        warnings.add(
          `Published ports on ${serviceName} are ignored during devpush deployments; managed Traefik ingress remains the only public entrypoint.`,
        )
        for (const port of service.ports) {
          addRouteTarget(routeTargets, serviceName, port)
        }
      }
      if (isRecord(service) && Array.isArray(service.expose)) {
        for (const port of service.expose) {
          addRouteTarget(routeTargets, serviceName, port)
        }
      }
      if (isRecord(service) && service.network_mode === 'host') {
        warnings.add(
          `${serviceName} uses host networking, which devpush ignores to preserve managed network isolation.`,
        )
      }
      if (!isRecord(service) || !Array.isArray(service.volumes)) {
        continue
      }

      for (const mount of service.volumes) {
        const volumeName = getComposeVolumeName(mount)
        if (volumeName) {
          volumes.add(volumeName)
        }
      }
    }
  }

  const targets = Array.from(routeTargets.values())
  const port80Targets = targets.filter((target) => target.port === 80)
  const suggestedTarget =
    port80Targets.length === 1
      ? port80Targets[0]
      : targets.length === 1
        ? targets[0]
        : undefined

  return {
    services,
    volumes: Array.from(volumes).sort(),
    warnings: Array.from(warnings),
    suggestedRoute: suggestedTarget
      ? {
          path: '/',
          service: suggestedTarget.service,
          port: suggestedTarget.port,
          stripPrefix: false,
        }
      : null,
  }
}

function addRouteTarget(
  targets: Map<string, { service: string; port: number }>,
  service: string,
  value: unknown,
) {
  const port = getComposeTcpTargetPort(value)
  if (port) {
    targets.set(`${service}:${port}`, { service, port })
  }
}

function getComposeTcpTargetPort(value: unknown) {
  if (typeof value === 'number') {
    return isValidPort(value) ? value : null
  }
  if (typeof value === 'string') {
    const [mapping = '', protocol = 'tcp'] = value.split('/')
    if (protocol.toLowerCase() !== 'tcp') {
      return null
    }
    const target = mapping.split(':').at(-1)
    const port = Number.parseInt(target ?? '', 10)
    return isValidPort(port) ? port : null
  }
  if (!isRecord(value)) {
    return null
  }
  if (
    typeof value.protocol === 'string' &&
    value.protocol.toLowerCase() !== 'tcp'
  ) {
    return null
  }
  const target = value.target
  if (typeof target === 'number') {
    return isValidPort(target) ? target : null
  }
  if (typeof target === 'string') {
    const port = Number.parseInt(target, 10)
    return isValidPort(port) ? port : null
  }
  return null
}

function isValidPort(port: number) {
  return Number.isInteger(port) && port > 0 && port <= 65_535
}

function getComposeVolumeName(mount: unknown) {
  if (typeof mount === 'string') {
    const [source = ''] = mount.split(':')
    const trimmed = source.trim()
    return isNamedComposeVolume(trimmed) ? trimmed : null
  }
  if (!isRecord(mount)) {
    return null
  }
  const type = typeof mount.type === 'string' ? mount.type : null
  const source = typeof mount.source === 'string' ? mount.source.trim() : ''
  if (type && type !== 'volume') {
    return null
  }
  return isNamedComposeVolume(source) ? source : null
}

function isNamedComposeVolume(value: string | null | undefined) {
  return Boolean(
    value &&
    !value.startsWith('/') &&
    !value.startsWith('./') &&
    !value.startsWith('../') &&
    !value.startsWith('~/') &&
    !value.includes('$'),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
