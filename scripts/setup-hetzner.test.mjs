import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApi, makeServer, parseOptions, run } from './setup-hetzner.mjs'

const catalog = {
  locations: [{ id: 1, name: 'fsn1' }],
  server_types: [{ id: 2, name: 'test-type', architecture: 'x86',
    locations: [{ id: 1, name: 'fsn1', available: true }], prices: [] }],
  images: [{ id: 3, name: 'ubuntu-24.04', architecture: 'x86', status: 'available', deprecated: null }],
  ssh_keys: [{ id: 4, name: 'test-key' }],
}
const options = { name: 'devpush-test', location: 'fsn1', type: 'test-type',
  image: 'ubuntu-24.04', 'ssh-key': 'test-key' }

test('rejects unavailable capacity, mismatched images, and missing keys', () => {
  const changed = structuredClone(catalog)
  changed.server_types[0].locations[0].available = false
  assert.throws(() => makeServer(options, changed, 'echo ok'), /unavailable/)
  changed.server_types[0].locations[0].available = true
  changed.images[0].architecture = 'arm'
  assert.throws(() => makeServer(options, changed, 'echo ok'), /architecture/)
  assert.throws(() => makeServer({ ...options, 'ssh-key': 'missing' }, catalog, 'echo ok'), /Invalid/)
})

test('previews without mutation; explicit create sends command only as cloud-init', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devpush-hetzner-'))
  try {
    const file = join(dir, 'install.sh')
    const command = 'curl https://staging.example/install?token=private-token | bash'
    await writeFile(file, command)
    const calls = [], output = []
    const api = async (path, body) => {
      calls.push({ path, body })
      if (body) return { server: { id: 99, name: options.name } }
      const resource = path.slice(1).split('?')[0]
      return { [resource]: catalog[resource], meta: { pagination: { next_page: null } } }
    }
    await run({ ...options, 'install-file': file }, api, text => output.push(text))
    assert.equal(calls.filter(call => call.body).length, 0)
    await run({ ...options, 'install-file': file, create: true, state: join(dir, 'state.json') }, api, text => output.push(text))
    const mutations = calls.filter(call => call.body)
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0].path, '/servers')
    assert.deepEqual(mutations[0].body.ssh_keys, [4])
    const encoded = mutations[0].body.user_data.match(/content: (.+)/)[1]
    assert.ok(Buffer.from(encoded, 'base64').toString().includes(command))
    assert.ok(!output.join('\n').includes('private-token'))
    assert.ok(output.join('\n').includes('still pending'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('does not retry ambiguous creation failures or expose provider error text', async () => {
  let count = 0
  const api = createApi('secret', async () => { count++; throw Error('network') })
  await assert.rejects(api('/servers', { name: 'test' }), /outcome unknown/)
  assert.equal(count, 1)
  const rejected = createApi('secret', async () => ({ ok: false, status: 400,
    json: async () => ({ error: { code: 'invalid_input', message: 'secret command' } }) }))
  await assert.rejects(rejected('/servers', {}), /Hetzner HTTP 400: invalid_input$/)
})

test('accepts the pnpm argument separator and rejects unknown flags', () => {
  assert.equal(parseOptions(['--', '--list']).list, true)
  assert.throws(() => parseOptions(['--typo']))
})

test('destruction previews, resumes missing resources, and removes only recorded IPs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devpush-destroy-'))
  const state = join(dir, 'state.json')
  try {
    await writeFile(state, JSON.stringify({ version: 1, name: 'devpush-test', serverId: 99, ipIds: [10, 11] }))
    const calls = []
    let deleted = false
    const missing = () => { throw Object.assign(new Error('not found'), { status: 404 }) }
    const api = async (path, body, method) => {
      calls.push({ path, method })
      if (method === 'DELETE') { if (path === '/servers/99') deleted = true; return {} }
      if (path === '/servers/99') return deleted ? missing() : { server: { name: 'devpush-test', labels: { purpose: 'devpush-test' } } }
      if (path === '/primary_ips/11') return missing()
      return { primary_ip: { assignee_id: deleted ? null : 99 } }
    }
    await run({ destroy: true, state }, api, () => {})
    assert.equal(calls.filter(c => c.method === 'DELETE').length, 0)
    await run({ destroy: true, yes: true, state }, api, () => {})
    assert.deepEqual(calls.filter(c => c.method === 'DELETE').map(c => c.path), ['/servers/99', '/primary_ips/10'])
    await assert.rejects(run({ destroy: true, state }, api, () => {}), /ENOENT/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('refuses deletion of an IP reassigned to another server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devpush-destroy-'))
  try {
    const state = join(dir, 'state.json')
    await writeFile(state, JSON.stringify({ version: 1, name: 'devpush-test', serverId: 99, ipIds: [10] }))
    const api = async path => path === '/servers/99'
      ? { server: { name: 'devpush-test', labels: { purpose: 'devpush-test' } } }
      : { primary_ip: { assignee_id: 88 } }
    await assert.rejects(run({ destroy: true, yes: true, state }, api, () => {}), /another server/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
