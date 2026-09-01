//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}', 'src/lib/utils.ts'],
    rules: {
      'import/consistent-type-specifier-style': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    ignores: [
      '.tmp/**',
      '.output/**',
      '.tanstack/**',
      'dist/**',
      'eslint.config.js',
      'prettier.config.js',
      'worker-configuration.d.ts',
    ],
  },
]
