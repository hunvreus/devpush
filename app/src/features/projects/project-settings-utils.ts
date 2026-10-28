import type { ProjectRoute } from '#devpush/server/projects/types'
import type { SectionNavigationItem } from '#devpush/components/section-navigation'

export const projectSettingsNavigationItems: Array<SectionNavigationItem> = [
  { href: '#general', label: 'General' },
  { href: '#build-and-deploy', label: 'Build & Deploy' },
  { href: '#environments', label: 'Environments' },
  { href: '#environment-variables', label: 'Environment variables' },
  { href: '#servers', label: 'Servers' },
  { href: '#routes', label: 'Routes' },
  { href: '#domains', label: 'Domains' },
  { href: '#notifications', label: 'Notifications' },
  { href: '#danger', label: 'Danger', destructive: true },
]

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

export class EnvFileValidationError extends Error {}

export function parseEnvFile(envFile: string) {
  const lines = envFile.replace(/\r\n?/g, '\n').split('\n')
  const rows: Array<{ key: string; value: string }> = []
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').trim()
    if (!line || line.startsWith('#')) continue
    const lineNumber = index + 1
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    )
    if (!match?.[1])
      throw new EnvFileValidationError(
        `Line ${lineNumber}: enter a valid KEY=value assignment.`,
      )
    let value = match[2] ?? ''
    const quote = value[0]
    if (quote === '"' || quote === "'" || quote === '`') {
      let end = closingQuote(value, quote)
      while (end < 0 && index + 1 < lines.length) {
        value += '\n' + lines[++index]
        end = closingQuote(value, quote)
      }
      if (end < 0)
        throw new EnvFileValidationError(
          `Line ${lineNumber}: close the quoted value.`,
        )
      const suffix = value.slice(end + 1).trim()
      if (suffix && !suffix.startsWith('#'))
        throw new EnvFileValidationError(
          `Line ${lineNumber}: unexpected text after the quoted value.`,
        )
      value = value.slice(1, end)
      if (quote === '"')
        value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
    } else {
      value = value.split('#')[0]?.trim() ?? ''
    }
    rows.push({ key: match[1], value })
  }
  return rows
}

function closingQuote(value: string, quote: string) {
  for (let index = 1; index < value.length; index++) {
    if (value[index] !== quote) continue
    let slashes = 0
    for (
      let previous = index - 1;
      previous >= 0 && value[previous] === '\\';
      previous--
    )
      slashes++
    if (slashes % 2 === 0) return index
  }
  return -1
}

export function isEnvFilePaste(value: string) {
  try {
    return parseEnvFile(value).length > 0
  } catch {
    return false
  }
}
