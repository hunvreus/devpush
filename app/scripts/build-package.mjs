import { build } from 'esbuild'
import { copyFile } from 'node:fs/promises'

// Node loads Vite config exports before Vite can transform TypeScript dependencies.
await build({
  entryPoints: [
    'src/package/vite.ts',
    'src/package/migrate.ts',
    'src/package/plugins.ts',
  ],
  outdir: 'dist/package',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
})

await copyFile('../LICENSE.md', 'dist/package/LICENSE.md')
