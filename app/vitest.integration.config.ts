import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    exclude: [
      '**/.git/**',
      '**/.output/**',
      '**/.tanstack/**',
      '**/dist/**',
      '**/node_modules/**',
    ],
    include: ['src/**/*.integration.test.ts'],
    pool: 'forks',
    watch: false,
  },
})
