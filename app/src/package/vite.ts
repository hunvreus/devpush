import { defineConfig, searchForWorkspaceRoot } from 'vite'
import type { Plugin } from 'vite'

import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { runtimeDependencies } from 'nitro/meta'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { relative, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { DevpushOptions } from './config'
import { generatePlugins } from './plugins'
import { clientDisconnectPlugin } from '../../dev/client-disconnect'

const watchIgnored = [
  '../.git/**',
  '../.tmp/**',
  '../agent/**',
  '../node_modules/**',
  '**/.git/**',
  '**/.output/**',
  '**/.tanstack/**',
  '**/.tmp/**',
  '**/.data/**',
  '**/.wrangler/**',
  '**/public/uploads/**',
  '**/dist/**',
  '**/node_modules/**',
]

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const nitroRequire = createRequire(import.meta.resolve('nitro/package.json'))

/** Build the source application in the consuming project, never in node_modules. */
export function devpush(options: DevpushOptions = {}) {
  const target = options.target ?? process.env.DEVPUSH_DEPLOY_TARGET ?? 'node'
  if (target !== 'node' && target !== 'cloudflare')
    throw new Error('devpush target must be node or cloudflare.')
  const root = resolve(options.root ?? process.cwd())
  const source = resolve(packageRoot, 'src')
  const tslib = fileURLToPath(import.meta.resolve('tslib/tslib.es6.mjs'))
  const generated = resolve(root, '.devpush')
  const plugins = generatePlugins(options.plugins ?? [], target, root)
  const installed = root !== packageRoot
  if (installed) mkdirSync(generated, { recursive: true })
  const routeTree = resolve(generated, 'routeTree.gen.ts')
  let development = false

  const deploymentStyles = {
    name: 'devpush-plugin-styles',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (/(?:\?|&)(?:url|raw)(?:&|$)/.test(id)) return
      if (
        id.split('?')[0] !==
        fileURLToPath(new URL('../../src/styles.css', import.meta.url))
      )
        return
      return (
        code +
        plugins.clientDirectories
          .map((directory) => `\n@source ${JSON.stringify(directory)};\n`)
          .join('') +
        [
          '.output',
          'dist',
          '.devpush',
          '.wrangler',
          '.tmp',
          'node_modules/.vite',
        ]
          .map(
            (directory) =>
              `\n@source not ${JSON.stringify(resolve(root, directory))};\n`,
          )
          .join('')
      )
    },
  }

  const isVitest = process.env.VITEST === 'true'
  const isCloudflare = target === 'cloudflare'
  const cloudflareAssetHeaders: Plugin = {
    name: 'devpush:cloudflare-asset-headers',
    generateBundle() {
      if (this.environment.name !== 'client') return
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source:
          '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',
      })
    },
  }
  const platformEnv = fileURLToPath(
    new URL(
      isCloudflare
        ? '../../src/server/runtime/platform-env.cloudflare.ts'
        : '../../src/server/runtime/platform-env.ts',
      import.meta.url,
    ),
  )

  const consumer: Plugin = {
    name: 'devpush:consumer',
    enforce: 'pre' as const,
    configResolved(config) {
      // The dev module runner needs Node to load CommonJS deps.
      // Production transforms the source package before Nitro.
      if (config.command !== 'serve') return
      for (const environment of Object.values(config.environments)) {
        environment.optimizeDeps.exclude = [
          ...new Set([
            ...(environment.optimizeDeps.exclude ?? []),
            'devpush',
            'devpush/plugins/server',
            'devpush/plugins/client',
            ...plugins.packageNames,
          ]),
        ]
      }
      if (isCloudflare) return
      development = true
      const environment = config.environments.ssr
      if (!environment) return
      environment.resolve.noExternal = [
        'devpush',
        /^@tanstack\//,
        /^seroval(?:-plugins)?(?:\/|$)/,
        ...plugins.packageNames,
      ]
    },
    async resolveId(id, importer) {
      // Nitro's generated modules resolve relative to the consumer.
      // Resolve its runtime imports from the package that owns them.
      if (
        development &&
        !isCloudflare &&
        runtimeDependencies.some(
          (name) => id === name || id.startsWith(name + '/'),
        )
      )
        return this.resolve(id, nitroRequire.resolve('nitro'), {
          skipSelf: true,
        })
      if (!isCloudflare && !development && id === 'better-sqlite3')
        return { id: 'devpush/sqlite', external: true }
      if (
        id === './routeTree.gen' &&
        importer?.split('?')[0] === resolve(source, 'router.tsx')
      )
        return routeTree
    },
  }
  const pluginBoundary: Plugin = {
    name: 'devpush:plugins',
    enforce: 'pre',
    transform(_code, id) {
      if (this.environment.name !== 'client') return
      const path = id.split('?')[0]!
      if (
        plugins.serverEntries.includes(path) ||
        (!path.startsWith(source + '/') && /\.server\.[cm]?[jt]sx?$/.test(path))
      )
        this.error(`Server-only plugin module imported by client: ${path}`)
    },
  }

  return defineConfig({
    root,
    publicDir: resolve(packageRoot, 'public'),
    ssr: installed ? { noExternal: true } : undefined,
    optimizeDeps: installed ? { exclude: ['devpush'] } : undefined,
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        ...(installed
          ? ['@tanstack/react-router', '@tanstack/react-query']
          : []),
      ],
      alias: [
        {
          find: '#devpush/plugins/registered-server',
          replacement: plugins.server,
        },
        {
          find: '#devpush/plugins/registered-client',
          replacement: plugins.client,
        },
        { find: /^tslib$/, replacement: tslib },
        {
          find: '#devpush/server/mcp/oauth-discovery',
          replacement: fileURLToPath(
            new URL(
              isCloudflare
                ? '../../src/server/mcp/oauth-discovery.cloudflare.ts'
                : '../../src/server/mcp/oauth-discovery.ts',
              import.meta.url,
            ),
          ),
        },
        {
          find: '#devpush/server/realtime/workspace-object',
          replacement: fileURLToPath(
            new URL(
              isCloudflare
                ? '../../src/server/realtime/workspace-object.cloudflare.ts'
                : '../../src/server/realtime/workspace-object.ts',
              import.meta.url,
            ),
          ),
        },
        {
          find: '#devpush/server/storage/local-object-store',
          replacement: fileURLToPath(
            new URL(
              isCloudflare
                ? '../../src/server/storage/local-object-store.cloudflare.ts'
                : '../../src/server/storage/local-object-store.ts',
              import.meta.url,
            ),
          ),
        },
        {
          find: '#devpush/server/runtime/platform-env',
          replacement: platformEnv,
        },
        {
          find: /^#devpush\/server\/db$/,
          replacement: fileURLToPath(
            new URL(
              process.env.DEVPUSH_TEST_LIBSQL === '1' && isVitest
                ? '../../src/test/db-libsql.ts'
                : isCloudflare
                  ? '../../src/server/db/index.cloudflare.ts'
                  : '../../src/server/db/index.ts',
              import.meta.url,
            ),
          ),
        },
      ],
      tsconfigPaths: !installed,
    },
    server: {
      fs: {
        allow: [
          searchForWorkspaceRoot(root),
          packageRoot,
          ...plugins.clientDirectories,
        ],
      },
      port: 7429,
      strictPort: true,
      allowedHosts: ['host.lima.internal'],
      watch: {
        ignored: watchIgnored,
      },
    },
    nitro: {
      scanDirs: [],
      watchOptions: {
        ignored: watchIgnored,
        usePolling: true,
      },
    },
    plugins: isVitest
      ? []
      : [
          ...(isCloudflare
            ? [
                cloudflareAssetHeaders,
                cloudflare({
                  configPath:
                    options.wranglerConfig ??
                    process.env.DEVPUSH_WRANGLER_CONFIG,
                  viteEnvironment: { name: 'ssr' },
                }),
              ]
            : [
                nitro({
                  features: { websocket: true },
                  plugins: [
                    resolve(
                      source,
                      'server/runtime/node-asset-cache-plugin.ts',
                    ),
                    resolve(source, 'server/runtime/node-scheduler-plugin.ts'),
                  ],
                  handlers: [
                    {
                      route: '/api/workspaces/updates',
                      handler: resolve(
                        source,
                        'server/realtime/node-handler.ts',
                      ),
                    },
                  ],
                  rollupConfig: { external: [/^@sentry\//] },
                  alias: { tslib },
                  traceDeps: installed
                    ? ['devpush/sqlite', 'better-sqlite3', 'tslib*']
                    : ['better-sqlite3', 'tslib*'],
                  scanDirs: [],
                  watchOptions: { ignored: watchIgnored, usePolling: true },
                }),
              ]),
          ...(installed ? [consumer] : []),
          pluginBoundary,
          deploymentStyles,
          tailwindcss(),
          tanstackStart({
            srcDirectory: relative(root, source),
            router: installed ? { generatedRouteTree: routeTree } : {},
          }),
          viteReact(),
          ...(!isCloudflare ? [clientDisconnectPlugin()] : []),
        ],
  })
}
