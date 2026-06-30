import { defineConfig } from 'vitest/config'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const isVitest = process.env.VITEST === 'true'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port: 7429,
    strictPort: true,
    allowedHosts: ['host.lima.internal'],
    watch: {
      ignored: [
        '../.git/**',
        '../.tmp/**',
        '../agent/**',
        '../legacy/**',
        '../node_modules/**',
        '**/.git/**',
        '**/.output/**',
        '**/.tanstack/**',
        '**/.tmp/**',
        '**/dist/**',
        '**/legacy/**',
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
        '../legacy/**',
        '../node_modules/**',
        '**/.git/**',
        '**/.output/**',
        '**/.tanstack/**',
        '**/.tmp/**',
        '**/dist/**',
        '**/legacy/**',
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
      '**/legacy/**',
      '**/node_modules/**',
      'src/**/*.integration.test.ts',
    ],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    watch: false,
  },
  plugins: isVitest
    ? []
    : [
        nitro({
          rollupConfig: { external: [/^@sentry\//] },
          scanDirs: [],
          watchOptions: {
            ignored: [
              '../.git/**',
              '../.tmp/**',
              '../agent/**',
              '../legacy/**',
              '../node_modules/**',
              '**/.git/**',
              '**/.output/**',
              '**/.tanstack/**',
              '**/.tmp/**',
              '**/dist/**',
              '**/legacy/**',
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
