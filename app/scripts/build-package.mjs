import { build } from 'esbuild'
import { copyFile, readFile, writeFile, rm } from 'node:fs/promises'

await rm('dist/package', { recursive: true, force: true })

// Node loads Vite config exports before Vite can transform TypeScript dependencies.
await build({
  entryPoints: {
    vite: 'src/package/vite.ts',
    migrate: 'src/package/migrate.ts',
    plugins: 'src/package/plugins.ts',
    cli: 'src/cli/cli.mjs',
  },
  outdir: 'dist/package',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
})

await copyFile('../LICENSE.md', 'dist/package/LICENSE.md')

await copyFile('scripts/backup-sqlite.mjs', 'dist/package/backup-sqlite.mjs')

const workspace = JSON.parse(await readFile('../package.json', 'utf8'))
await writeFile(
  'dist/package/dependency-overrides.json',
  JSON.stringify(workspace.pnpm.overrides, null, 2) + '\n',
)
