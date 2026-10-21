import { defineConfig } from 'vitest/config'

import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { fileURLToPath } from 'node:url'
import { clientDisconnectPlugin } from './dev/client-disconnect'

import {
  resolveServerDeployment,
  deploymentStylesSource,
} from './deployment.config.mjs'

const deploymentEntry = resolveServerDeployment(
  process.env,
  fileURLToPath(new URL('.', import.meta.url)),
)

const deploymentStyles = {
  name: 'devpush-deployment-styles',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (/(?:\?|&)(?:url|raw)(?:&|$)/.test(id)) return
    if (
      id.split('?')[0] !==
      fileURLToPath(new URL('./src/styles.css', import.meta.url))
    )
      return
    const source = deploymentStylesSource(
      deploymentEntry.clientDirectory,
      fileURLToPath(new URL('.', import.meta.url)),
    )
    if (source) return code + source
  },
}

const isVitest = process.env.VITEST === 'true'
const isCloudflare = process.env.DEVPUSH_DEPLOY_TARGET === 'cloudflare'
const platformEnv = fileURLToPath(
  new URL(
    isCloudflare
      ? './src/server/runtime/platform-env.cloudflare.ts'
      : './src/server/runtime/platform-env.ts',
    import.meta.url,
  ),
)

const config = defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      ...deploymentEntry.aliases,
      {
        find: '@/server/mcp/oauth-discovery',
        replacement: fileURLToPath(
          new URL(
            isCloudflare
              ? './src/server/mcp/oauth-discovery.cloudflare.ts'
              : './src/server/mcp/oauth-discovery.ts',
            import.meta.url,
          ),
        ),
      },
      {
        find: '@/server/realtime/workspace-object',
        replacement: fileURLToPath(
          new URL(
            isCloudflare
              ? './src/server/realtime/workspace-object.cloudflare.ts'
              : './src/server/realtime/workspace-object.ts',
            import.meta.url,
          ),
        ),
      },
      {
        find: '@/server/storage/local-object-store',
        replacement: fileURLToPath(
          new URL(
            isCloudflare
              ? './src/server/storage/local-object-store.cloudflare.ts'
              : './src/server/storage/local-object-store.ts',
            import.meta.url,
          ),
        ),
      },
      {
        find: '@/server/admin/installation-current',
        replacement: fileURLToPath(
          new URL(
            isCloudflare
              ? './src/server/admin/installation-current.cloudflare.ts'
              : './src/server/admin/installation-current.ts',
            import.meta.url,
          ),
        ),
      },
      { find: '@/server/runtime/platform-env', replacement: platformEnv },
      {
        find: /^@\/server\/db$/,
        replacement: fileURLToPath(
          new URL(
            process.env.DEVPUSH_TEST_LIBSQL === '1' && isVitest
              ? './src/test/db-libsql.ts'
              : isCloudflare
                ? './src/server/db/index.cloudflare.ts'
                : './src/server/db/index.ts',
            import.meta.url,
          ),
        ),
      },
    ],
    tsconfigPaths: true,
  },
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL('..', import.meta.url)),
        deploymentEntry.directory,
      ],
    },
    port: 7429,
    strictPort: true,
    allowedHosts: ['host.lima.internal'],
    watch: {
      ignored: [
        '../.git/**',
        '../.tmp/**',
        '../agent/**',
        '../node_modules/**',
        '**/.git/**',
        '**/.output/**',
        '**/.tanstack/**',
        '**/.tmp/**',
        '**/dist/**',
        '**/node_modules/**',
      ],
    },
  },
  nitro: {
    scanDirs: [],
    watchOptions: {
      ignored: [
        '../.git/**',
        '../.tmp/**',
        '../agent/**',
        '../node_modules/**',
        '**/.git/**',
        '**/.output/**',
        '**/.tanstack/**',
        '**/.tmp/**',
        '**/dist/**',
        '**/node_modules/**',
      ],
      usePolling: true,
    },
  },
  test: {
    exclude: [
      '**/.git/**',
      '**/.output/**',
      '**/.tanstack/**',
      '**/dist/**',
      '**/node_modules/**',
      'src/**/*.integration.test.ts',
    ],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    watch: false,
  },
  plugins: isVitest
    ? []
    : isCloudflare
      ? [
          cloudflare({
            configPath: process.env.DEVPUSH_WRANGLER_CONFIG,
            viteEnvironment: { name: 'ssr' },
          }),
          deploymentStyles,
          tailwindcss(),
          tanstackStart(),
          viteReact(),
        ]
      : [
          nitro({
            features: { websocket: true },
            handlers: [
              {
                route: '/api/workspaces/updates',
                handler: fileURLToPath(
                  new URL(
                    './src/server/realtime/node-handler.ts',
                    import.meta.url,
                  ),
                ),
              },
            ],
            rollupConfig: { external: [/^@sentry\//] },
            scanDirs: [],
            watchOptions: {
              ignored: [
                '../.git/**',
                '../.tmp/**',
                '../agent/**',
                '../node_modules/**',
                '**/.git/**',
                '**/.output/**',
                '**/.tanstack/**',
                '**/.tmp/**',
                '**/dist/**',
                '**/node_modules/**',
              ],
              usePolling: true,
            },
          }),
          deploymentStyles,
          tailwindcss(),
          tanstackStart(),
          viteReact(),
          clientDisconnectPlugin(),
        ],
})

export default config
