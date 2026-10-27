import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pluginApiVersion } from '../plugins/version'

export { pluginApiVersion } from '../plugins/version'
export type Runtime = 'node' | 'cloudflare'

/** Build-time declaration. Entry modules are imported separately by target. */
export interface DevpushPlugin {
  id: string
  apiVersion: typeof pluginApiVersion
  runtimes: readonly Runtime[]
  server?: string | URL
  client?: string | URL
}

export function definePlugin(plugin: DevpushPlugin): Readonly<DevpushPlugin>
export function definePlugin(value: unknown): Readonly<DevpushPlugin> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Plugin declaration must be an object.')
  const plugin = value as Record<string, unknown>
  if (typeof plugin.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(plugin.id))
    throw new Error(
      'Plugin IDs must use lowercase letters, numbers and hyphens.',
    )
  if (plugin.apiVersion !== pluginApiVersion)
    throw new Error(`Incompatible plugin API: ${plugin.id}`)
  if (
    !Array.isArray(plugin.runtimes) ||
    !plugin.runtimes.length ||
    plugin.runtimes.some(
      (runtime: unknown) => runtime !== 'node' && runtime !== 'cloudflare',
    )
  )
    throw new Error(`Invalid plugin runtimes: ${plugin.id}`)
  for (const side of ['server', 'client']) {
    const entry = plugin[side]
    if (entry !== undefined && typeof entry !== 'string' && !(entry instanceof URL))
      throw new Error(`Invalid ${side} entry for plugin ${plugin.id}.`)
    if (entry instanceof URL && entry.protocol !== 'file:')
      throw new Error(`Plugin ${plugin.id} entries must use file URLs.`)
  }
  if (!plugin.server && !plugin.client)
    throw new Error(`Plugin has no entry modules: ${plugin.id}`)
  return Object.freeze({
    ...plugin,
    runtimes: Object.freeze([...plugin.runtimes]),
  }) as Readonly<DevpushPlugin>
}

export function generatePlugins(
  plugins: readonly DevpushPlugin[],
  target: Runtime,
  root: string,
) {
  const seen = new Set<string>()
  const entries = plugins.map((value) => {
    const plugin = definePlugin(value)
    if (seen.has(plugin.id)) throw new Error(`Duplicate plugin: ${plugin.id}`)
    seen.add(plugin.id)
    if (!plugin.runtimes.includes(target))
      throw new Error(`Plugin ${plugin.id} does not support ${target}.`)
    function entry(module: string | URL | undefined) {
      if (module === undefined) return undefined
      const path = module instanceof URL ? fileURLToPath(module) : module
      if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isFile())
        throw new Error(
          `Plugin ${plugin.id} entry must be an existing absolute file: ${path}`,
        )
      return path.replaceAll('\\', '/')
    }
    return {
      id: plugin.id,
      server: entry(plugin.server),
      client: entry(plugin.client),
    }
  })
  const directory = resolve(root, '.devpush')
  mkdirSync(directory, { recursive: true })
  const paths = {
    server: resolve(directory, 'plugins.server.ts'),
    client: resolve(directory, 'plugins.ui.ts'),
  }
  for (const side of ['server', 'client'] as const) {
    const selected = entries.filter((entry) => entry[side])
    const imports = selected.map(
      (entry, index) =>
        `import plugin${index} from ${JSON.stringify(entry[side])}`,
    )
    const declarations = selected.map(
      (entry, index) =>
        `{ id: ${JSON.stringify(entry.id)}, implementation: plugin${index} }`,
    )
    writeFileSync(
      paths[side],
      `${imports.join('\n')}\nexport default [${declarations.join(',\n')}]\n`,
    )
  }
  return {
    ...paths,
    clientDirectories: [
      ...new Set(
        entries.flatMap((entry) =>
          entry.client ? [dirname(entry.client)] : [],
        ),
      ),
    ],
    serverEntries: entries.flatMap((entry) =>
      entry.server ? [entry.server] : [],
    ),
    packageNames: [
      ...new Set(
        entries.flatMap((entry) => {
          const file = entry.server ?? entry.client
          if (!file) return []
          let packageDirectory = dirname(file)
          for (;;) {
            const manifest = resolve(packageDirectory, 'package.json')
            if (existsSync(manifest)) {
              const metadata = JSON.parse(readFileSync(manifest, 'utf8')) as {
                name?: unknown
              }
              return typeof metadata.name === 'string' ? [metadata.name] : []
            }
            const parent = dirname(packageDirectory)
            if (parent === packageDirectory) return []
            packageDirectory = parent
          }
        }),
      ),
    ],
  }
}
