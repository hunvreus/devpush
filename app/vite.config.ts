import { defineConfig, mergeConfig } from 'vitest/config'
import { devpush } from './src/package/vite'

export default mergeConfig(
  devpush(),
  defineConfig({
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
  }),
)
