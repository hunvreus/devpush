import type { ProjectRoute } from '@/server/projects/service'

export function getEffectiveProjectRoutes(
  routes: Array<ProjectRoute>,
  environmentId: string,
) {
  const effective = new Map<string, ProjectRoute>()

  for (const route of routes) {
    if (!route.environmentId) {
      effective.set(route.path, route)
    }
  }
  for (const route of routes) {
    if (route.environmentId === environmentId) {
      effective.set(route.path, route)
    }
  }

  return Array.from(effective.values())
}

export function parseEnvFile(envFile: string) {
  return envFile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const match = /^([^=]+)=(.*)$/.exec(line)
      if (!match) {
        return null
      }
      return {
        key: match[1].trim(),
        value: match[2].trim().replace(/^["']|["']$/g, ''),
      }
    })
    .filter((item): item is { key: string; value: string } => Boolean(item))
}

export function isEnvFilePaste(value: string) {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  return (
    lines.length > 0 &&
    lines.every((line) => /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(line))
  )
}
