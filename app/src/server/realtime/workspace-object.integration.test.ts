import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import assert from 'node:assert/strict'
import { test } from 'vitest'

test('hibernating socket upgrades, auto-responds and receives RPC hints', async () => {
  const compiled = await build({
    stdin: {
      contents: `export { WorkspaceUpdates } from './src/server/realtime/workspace-object.cloudflare.ts'; export default { async fetch(request, env) { const stub = env.UPDATES.getByName(new URL(request.url).searchParams.get('workspace') || 'a'); if (new URL(request.url).pathname === '/publish') { await stub.publish('deployments', new URL(request.url).searchParams.has('revoke') ? [] : ['session']); return new Response('ok') } return stub.fetch(request) } }`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:workers'],
    write: false,
  })
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: compiled.outputFiles[0]!.text,
      compatibilityDate: '2026-10-01',
      durableObjects: {
        UPDATES: { className: 'WorkspaceUpdates', useSQLite: true },
      },
    }),
  )
  try {
    const response = await mf.dispatchFetch('http://local/socket', {
      headers: {
        Upgrade: 'websocket',
        'x-devpush-session': 'session',
        'x-devpush-session-expires': String(Date.now() + 60000),
      },
    })
    assert.equal(response.status, 101)
    const ws = response.webSocket!
    ws.accept()
    const next = () =>
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('message timeout')),
          3000,
        )
        ws.addEventListener(
          'message',
          (event) => {
            clearTimeout(timeout)
            resolve(String(event.data))
          },
          { once: true },
        )
      })
    const pong = next()
    ws.send('ping')
    assert.equal(await pong, 'pong')
    const changed = next()
    await mf.dispatchFetch('http://local/publish')
    assert.deepEqual(JSON.parse(await changed), {
      type: 'changed',
      kind: 'deployments',
    })
    const closed = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('revocation timeout')),
        3000,
      )
      ws.addEventListener(
        'close',
        (event) => {
          clearTimeout(timeout)
          resolve(event.code)
        },
        { once: true },
      )
    })
    await mf.dispatchFetch('http://local/publish?revoke=1')
    assert.equal(await closed, 1008)
  } finally {
    await mf.dispose()
  }
}, 15000)
