import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { assertPublicPaths } from '../../scripts/validate-public-files.mjs'
import { createHash } from 'node:crypto'
import {
  lstatSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = mkdtempSync(join(tmpdir(), 'devpush-package-'))
const logs = resolve(directory, 'logs')
mkdirSync(logs)
const metadata = JSON.parse(readFileSync(resolve(app, 'package.json')))
// No developer app credentials, deployment aliases or local .env files enter the fixture.
const environment = Object.fromEntries(
  ['PATH', 'HOME', 'USER', 'TMPDIR'].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
)
environment.NO_COLOR = '1'
environment.DEVPUSH_SMOKE_PLUGINS = '1'
console.log(`Independent package consumer: ${directory}`)
async function run(
  name,
  command,
  args,
  cwd = directory,
  extra = {},
  expectedError,
) {
  console.log(name)
  const output = []
  const child = spawn(command, args, {
    cwd,
    env: { ...environment, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => output.push(chunk))
  child.stderr.on('data', (chunk) => output.push(chunk))
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  const text = Buffer.concat(output).toString()
  writeFileSync(resolve(logs, `${name}.log`), text)
  if (expectedError) {
    assert.notEqual(code, 0, `${name} unexpectedly succeeded`)
    assert(
      text.includes(expectedError),
      `${name} failed for another reason:\n${text.slice(-12000)}`,
    )
  } else assert.equal(code, 0, `${name} failed:\n${text.slice(-12000)}`)
}
function digest(path) {
  const hash = createHash('sha256')
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const entry = join(directory, name)
      if (lstatSync(entry).isDirectory()) visit(entry)
      else hash.update(entry.slice(path.length)).update(readFileSync(entry))
    }
  }
  visit(path)
  return hash.digest('hex')
}
function assertApplicationNotOptimized() {
  const cache = resolve(directory, 'node_modules/.vite')
  if (!existsSync(cache)) return
  const source = realpathSync(resolve(directory, 'node_modules/devpush/src'))
  for (const name of readdirSync(cache)) {
    const metadataPath = resolve(cache, name, '_metadata.json')
    if (!existsSync(metadataPath)) continue
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    for (const [id, entry] of Object.entries(metadata.optimized ?? {})) {
      const file = resolve(dirname(metadataPath), entry.src)
      if (existsSync(file))
        assert(
          !realpathSync(file).startsWith(source + '/'),
          `Application module was prebundled: ${id}`,
        )
    }
  }
}
function assertClientBoundary(path) {
  let javascript = ''
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.name.endsWith('.js'))
        javascript += readFileSync(file, 'utf8')
    }
  }
  visit(path)
  for (const id of ['local-proof', 'npm-proof']) {
    assert(
      javascript.includes('CLIENT_ONLY_' + id),
      `Missing client plugin: ${id}`,
    )
    assert(
      !javascript.includes('SERVER_ONLY_' + id),
      `Server plugin leaked into client: ${id}`,
    )
  }
}
await run('pack', 'pnpm', ['pack', '--pack-destination', directory], app)
const archive = resolve(directory, `${metadata.name}-${metadata.version}.tgz`)
assertPublicPaths(
  execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .split('\n')
    .filter((path) => path && !path.endsWith('/')),
  { packageContents: true },
)
writeFileSync(
  resolve(directory, 'package.json'),
  JSON.stringify(
    {
      name: 'devpush-independent-consumer',
      private: true,
      type: 'module',
      scripts: { build: 'vite build' },
      dependencies: {
        devpush: `file:./${metadata.name}-${metadata.version}.tgz`,
        '@devpush/fixture-plugin': 'file:./fixture-plugin',
        ...Object.fromEntries(
          ['typescript', '@types/react', '@types/react-dom', '@types/node'].map(
            (name) => [
              name,
              JSON.parse(
                readFileSync(
                  resolve(app, 'node_modules', name, 'package.json'),
                ),
              ).version,
            ],
          ),
        ),
        ...metadata.peerDependencies,
        wrangler: JSON.parse(
          readFileSync(resolve(app, 'node_modules/wrangler/package.json')),
        ).version,
      },
      pnpm: {
        onlyBuiltDependencies: [
          'better-sqlite3',
          'esbuild',
          'lightningcss',
          'workerd',
        ],
      },
    },
    null,
    2,
  ),
)
const npmPlugin = resolve(directory, 'fixture-plugin')
mkdirSync(npmPlugin)
writeFileSync(
  resolve(npmPlugin, 'package.json'),
  JSON.stringify({
    name: '@devpush/fixture-plugin',
    version: '1.0.0',
    type: 'module',
    exports: './index.mjs',
    peerDependencies: {
      devpush: metadata.version,
      react: metadata.peerDependencies.react,
    },
  }),
)
function pluginFixture(root, id, name) {
  writeFileSync(
    resolve(root, name + '.server.mjs'),
    `import { defineServerPlugin, WorkspacePolicyError } from 'devpush/plugins/server'
const events = new Map(), denied = new Set()
const orderKey=Symbol.for('devpush.package-proof.order')
const order=globalThis[orderKey] ??= new Map()
const record = (team, event) => {
 const marker='${id}:'+event
 const values=events.get(team)||[]; values.push(marker); events.set(team,values)
 const sequence=order.get(team)||[]; sequence.push(marker); order.set(team,sequence)
}
export default defineServerPlugin(() => ({
  workspaceAccess: {
    async run(input, action) {
      record(input.teamId, 'before')
      try {
        if (denied.has(input.teamId)) throw new WorkspacePolicyError('restricted')
        return await action()
      } finally {record(input.teamId,'after')}
    },
  },
  serverLifecycle: {reconcile:async server=>record(server.teamId,'reconcile'),maintain:async()=>{}},
  ${id === 'local-proof' ? "certificates:{request:async ({server})=>{record(server.teamId,'certificate');return {status:'configuration',dnsNames:['*.proof.example.test']}}}," : ''}
  handleRequest: async (request, session) => {
    const url=new URL(request.url),team=url.searchParams.get('team')
    if(url.pathname.endsWith('/events')) return Response.json(events.get(team)||[])
    if(url.pathname.endsWith('/order')) return Response.json(order.get(team)||[])
    if(url.pathname.endsWith('/deny') && request.method==='POST') {denied.add(team);return new Response(null,{status:204})}
    return Response.json({ id: '${id}', session, marker: 'SERVER_ONLY_${id}' })
  }
}))
`,
  )
  writeFileSync(
    resolve(root, name + '.ui.tsx'),
    `import { defineClientPlugin } from 'devpush/plugins/client'
import { Button } from 'devpush/ui/button'
export default defineClientPlugin({workspace: {header: () => <Button>CLIENT_ONLY_${id}</Button>}})
`,
  )
  writeFileSync(
    resolve(root, name + '.mjs'),
    `import { definePlugin, pluginApiVersion } from 'devpush/plugins'
export default definePlugin({id:'${id}',apiVersion:pluginApiVersion,runtimes:['node','cloudflare'],server:new URL('./${name}.server.mjs',import.meta.url),client:new URL('./${name}.ui.tsx',import.meta.url)})
`,
  )
}
pluginFixture(directory, 'local-proof', 'local')
pluginFixture(npmPlugin, 'npm-proof', 'index')
writeFileSync(
  resolve(directory, 'vite.config.mjs'),
  "import { devpush } from 'devpush/vite'\nimport local from './local.mjs'\nimport npm from '@devpush/fixture-plugin'\nexport default devpush({plugins:[local,npm]})\n",
)
writeFileSync(
  resolve(directory, 'type-proof.tsx'),
  `import { Button } from 'devpush/ui/button'
import { defineClientPlugin } from 'devpush/plugins/client'
export default defineClientPlugin({workspace:{header:()=> <Button variant="outline">Typed plugin UI</Button>}})
`,
)
writeFileSync(
  resolve(directory, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      jsx: 'react-jsx',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    files: ['type-proof.tsx'],
  }),
)
await run('install', 'pnpm', ['install', '--prefer-offline'])
await run('consumer-types', 'pnpm', ['exec', 'tsc', '--noEmit'])
const installed = resolve(directory, 'node_modules/devpush')
const before = digest(resolve(installed, 'src'))
await run('migrate', process.execPath, [
  '--input-type=module',
  '-e',
  "import { migrateNode } from 'devpush/migrate'; await migrateNode()",
])
if (!process.argv.includes('--development-only')) {
  await run('node-build', 'pnpm', ['build'])
  assertClientBoundary(resolve(directory, '.output/public'))
  assert.equal(
    digest(resolve(installed, 'src')),
    before,
    'Build must not modify installed application source',
  )
  await run(
    'node-smoke',
    process.execPath,
    [resolve(app, 'scripts/smoke-node.mjs')],
    app,
    { DEVPUSH_SMOKE_APP_DIR: directory },
  )
}
await run(
  'node-development',
  process.execPath,
  [resolve(app, 'scripts/smoke-node.mjs')],
  app,
  { DEVPUSH_SMOKE_APP_DIR: directory, DEVPUSH_SMOKE_DEVELOPMENT: '1' },
)
assert.equal(
  digest(resolve(installed, 'src')),
  before,
  'Development must not modify installed application source',
)
assertApplicationNotOptimized()
if (
  !process.argv.includes('--node-only') &&
  !process.argv.includes('--development-only')
) {
  await run(
    'worker-smoke',
    process.execPath,
    [resolve(app, 'scripts/smoke-worker.mjs'), 'd1'],
    app,
    { DEVPUSH_SMOKE_APP_DIR: directory },
  )
  assert.equal(
    digest(resolve(installed, 'src')),
    before,
    'Worker build must not modify installed application source',
  )
  assertClientBoundary(resolve(directory, 'dist/client'))
  await run(
    'worker-development',
    process.execPath,
    [resolve(app, 'scripts/smoke-worker.mjs'), 'd1'],
    app,
    { DEVPUSH_SMOKE_APP_DIR: directory, DEVPUSH_SMOKE_DEVELOPMENT: '1' },
  )
  assert.equal(
    digest(resolve(installed, 'src')),
    before,
    'Worker development must not modify installed application source',
  )
  assertApplicationNotOptimized()
}
if (!process.argv.includes('--development-only')) {
  const ui = resolve(directory, 'local.ui.tsx')
  const original = readFileSync(ui, 'utf8')
  try {
    writeFileSync(
      ui,
      `import server from './local.server.mjs'
import { defineClientPlugin } from 'devpush/plugins/client'
export default defineClientPlugin({workspace:{header:()=> <span>{String(server)}</span>}})
`,
    )
    await run(
      'reject-server-import',
      'pnpm',
      ['build'],
      directory,
      {},
      'Server-only plugin module imported by client',
    )
  } finally {
    writeFileSync(ui, original)
  }
}
const scope = process.argv.includes('--development-only')
  ? 'Development'
  : process.argv.includes('--node-only')
    ? 'Node'
    : 'Node and Workers'
console.log(`${scope} package proof passed. Logs: ${logs}`)
