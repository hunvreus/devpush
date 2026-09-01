import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from './vite.config'

const config = mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      exclude: ['**/.git/**', '**/dist/**', '**/node_modules/**'],
      fileParallelism: false,
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
