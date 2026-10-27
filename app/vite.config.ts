import { defineConfig, mergeConfig } from 'vitest/config'
import { devpush } from './src/package/vite'

export default mergeConfig(
  devpush(),
  defineConfig({
    test: {
      // Bound concurrent jsdom processes on contributor machines and CI runners.
      maxWorkers: 2,
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
  }),
)
