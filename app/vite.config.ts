import { defineConfig } from 'vitest/config'

import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { fileURLToPath } from 'node:url'

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
    alias: {
      '@/server/runtime/platform-env': platformEnv,
    },
    tsconfigPaths: true,
  },
  server: {
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
          cloudflare({ viteEnvironment: { name: 'ssr' } }),
          tailwindcss(),
          tanstackStart(),
          viteReact(),
        ]
      : [
          nitro({
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
          tailwindcss(),
          tanstackStart(),
          viteReact(),
        ],
})

export default config
