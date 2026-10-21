import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from './vite.config'

const config = mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      exclude: ['**/.git/**', '**/dist/**', '**/node_modules/**'],
      fileParallelism: false,
      setupFiles: ['src/test/setup-sqlite.ts'],
      env: {
        DEVPUSH_BACKUPS_ENABLED: 'true',
        DEVPUSH_SECRET_ENCRYPTION_KEY:
          'devpush-integration-encryption-key-32-characters',
      },
      include: ['src/**/*.integration.test.ts'],
      maxWorkers: 1,
      testTimeout: 10_000,
      watch: false,
    },
  }),
)

config.test = {
  ...config.test,
  exclude: ['**/.git/**', '**/dist/**', '**/node_modules/**'],
  include: ['src/**/*.integration.test.ts'],
}

export default config
