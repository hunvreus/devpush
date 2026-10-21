#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

// Documented validation, authorization and capacity rejections precede creation.
// Service errors, unknown codes and unreadable responses remain ambiguous.
const creationRejectionCodes = new Set([
  'json_error', 'unauthorized', 'forbidden', 'maintenance',
  'resource_limit_exceeded', 'not_found', 'method_not_allowed',
  'uniqueness_error', 'deprecated_api_endpoint', 'resource_unavailable',
  'invalid_input', 'unsupported_error', 'protected', 'rate_limit_exceeded',
])

export function parseOptions(args) {
  return parseArgs({ args: args[0] === '--' ? args.slice(1) : args, options: {
    help: { type: 'boolean' }, list: { type: 'boolean' },
    create: { type: 'boolean' }, name: { type: 'string' },
    destroy: { type: 'boolean' }, yes: { type: 'boolean' },
    state: { type: 'string', default: '.data/hetzner-test.json' },
    location: { type: 'string' }, type: { type: 'string' },
    image: { type: 'string', default: 'ubuntu-24.04' },
    'ssh-key': { type: 'string' }, 'install-file': { type: 'string' },
  } }).values
}

export function createApi(token, request = fetch) {
  return async (path, body, method = body ? 'POST' : 'GET') => {
    let response
    try {
      response = await request(`https://api.hetzner.cloud/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      // A failed response does not prove that a server was not created.
      throw new Error(body
        ? 'Creation outcome unknown. Check the Hetzner Console before retrying.'
        : 'Could not reach the Hetzner API.')
    }
    if (response.status === 204) return {}
    let data
    try {
      data = await response.json()
    } catch {
      throw new Error(body
        ? 'Creation outcome unknown. Check the Hetzner Console before retrying.'
        : `Hetzner HTTP ${response.status}: invalid response`)
    }
    if (!response.ok) {
      const error = new Error(`Hetzner HTTP ${response.status}: ${data.error?.code || 'request_failed'}`)
      error.status = response.status
      error.creationRejected = response.status >= 400 && response.status < 500
        && creationRejectionCodes.has(data.error?.code)
      throw error
    }
    return data
  }
}

async function saveState(path, state) {
  await writeFile(`${path}.new`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  await rename(`${path}.new`, path)
}

async function getOrMissing(api, path) {
  try { return await api(path) } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

export async function destroy(options, api, output) {
  const path = options.state || '.data/hetzner-test.json'
  const state = JSON.parse(await readFile(path, 'utf8'))
  if (state.version !== 1 || !Number.isSafeInteger(state.serverId) || !Array.isArray(state.ipIds)
    || state.ipIds.some(id => !Number.isSafeInteger(id))) {
    throw new Error('State is incomplete. Check Hetzner Console; do not retry creation blindly.')
  }
  const existing = await getOrMissing(api, `/servers/${state.serverId}`)
  if (existing && (existing.server.name !== state.name || existing.server.labels?.purpose !== 'devpush-test')) {
    throw new Error('Tracked server identity changed; refusing deletion.')
  }
  for (const id of state.ipIds) {
    const current = await getOrMissing(api, `/primary_ips/${id}`)
    if (current?.primary_ip.assignee_id && current.primary_ip.assignee_id !== state.serverId) {
      throw new Error(`IP ${id} is now assigned to another server; refusing deletion.`)
    }
  }
  output(`Delete tracked server ${state.serverId} (${state.name}) and Primary IPs: ${state.ipIds.join(', ') || 'none'}.`)
  if (!options.yes) { output('Preview only. Add --yes to confirm destruction.'); return }
  if (existing) {
    try { await api(`/servers/${state.serverId}`, undefined, 'DELETE') } catch (error) {
      if (error.status !== 404) throw error
    }
    for (let attempt = 0; ; attempt++) {
      if (!await getOrMissing(api, `/servers/${state.serverId}`)) break
      if (attempt >= 30) throw new Error('Server deletion is still pending. Rerun --destroy --yes to resume.')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  for (const id of state.ipIds) {
    let current = await getOrMissing(api, `/primary_ips/${id}`)
    // Server disappearance can precede Primary IP detachment/auto-deletion.
    for (let attempt = 0; current?.primary_ip.assignee_id === state.serverId; attempt++) {
      if (attempt >= 30) throw new Error(`IP ${id} detachment is still pending. Rerun --destroy --yes to resume.`)
      await new Promise(resolve => setTimeout(resolve, 1000))
      current = await getOrMissing(api, `/primary_ips/${id}`)
    }
    if (!current) continue
    if (current.primary_ip.assignee_id) throw new Error(`IP ${id} is still assigned; refusing deletion.`)
    try { await api(`/primary_ips/${id}`, undefined, 'DELETE') } catch (error) {
      if (error.status !== 404) throw error
    }
  }
  await unlink(path)
  output('Tracked server and IPs deleted. Local state removed. Remove the devpush record separately.')
}

async function list(api, resource, query = '') {
  const rows = []
  let page = 1
  while (page) {
    const data = await api(`/${resource}?per_page=50&page=${page}${query}`)
    rows.push(...data[resource])
    page = data.meta?.pagination?.next_page
  }
  return rows
}

export function makeServer(options, catalog, command) {
  const find = (rows, value) => rows.find(row => row.name === value || String(row.id) === value)
  const location = find(catalog.locations, options.location)
  const type = find(catalog.server_types, options.type)
  const matchingImages = catalog.images.filter(row => row.name === options.image || String(row.id) === options.image)
  const image = matchingImages.find(row => row.architecture === type?.architecture) || matchingImages[0]
  const key = find(catalog.ssh_keys, options['ssh-key'])
  if (!location || !type || !image || !key) throw new Error('Invalid location, type, image, or SSH key. Run --list for current options.')
  if (!type.locations?.some(entry => entry.id === location.id && entry.available === true)) {
    throw new Error('This server type is unavailable in the selected location.')
  }
  if (image.architecture !== type.architecture) throw new Error('Image and server architecture do not match.')
  if (image.status !== 'available' || image.deprecated) throw new Error('Image is unavailable or deprecated.')
  if (!command.trim()) throw new Error('Install file is empty.')
  if (Buffer.byteLength(command) > 20_000) throw new Error('Install file is too large; provide the short command from devpush.')
  const script = Buffer.from(`#!/bin/bash\nset -euo pipefail\n${command}\n`).toString('base64')
  return {
    name: options.name, location: location.id, server_type: type.id,
    image: image.id, ssh_keys: [key.id], start_after_create: true,
    labels: { purpose: 'devpush-test' },
    user_data: `#cloud-config\npackage_update: true\npackages: [curl, ca-certificates, git]\nwrite_files:\n  - path: /root/devpush-install.sh\n    permissions: '0700'\n    encoding: b64\n    content: ${script}\nruncmd:\n  - [bash, /root/devpush-install.sh]\n`,
  }
}

export async function run(options, api, output = console.log) {
  if (options.destroy && (options.create || options.list)) throw new Error('Use --destroy by itself.')
  if (options.destroy) return destroy(options, api, output)
  const catalog = Object.fromEntries(await Promise.all([
    'locations', 'server_types', 'images', 'ssh_keys',
  ].map(async resource => [resource, await list(api, resource, resource === 'images' ? '&type=system' : '')])))
  if (options.list) {
    output(JSON.stringify(catalog, null, 2))
    return
  }
  for (const flag of ['name', 'location', 'type', 'ssh-key', 'install-file']) {
    if (!options[flag]) throw new Error(`Missing --${flag}.`)
  }
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(options.name)) throw new Error('Use a server name containing letters, digits, and hyphens (maximum 63 characters).')
  const command = await readFile(options['install-file'], 'utf8')
  const body = makeServer(options, catalog, command)
  const type = catalog.server_types.find(row => row.id === body.server_type)
  const location = catalog.locations.find(row => row.id === body.location)
  output(JSON.stringify({ name: body.name, type: type.name, location: location.name,
    image: options.image, price: type.prices?.find(price => price.location === location.name),
    note: 'Server price excludes public IP charges. Install command omitted.' }, null, 2))
  if (!options.create) {
    output('Preview only. Add --create to create a billable server.')
    return
  }
  // Never retry creation automatically: the first request may have succeeded.
  const path = options.state || '.data/hetzner-test.json'
  await mkdir(dirname(path), { recursive: true })
  // Reserve before the paid request so a second invocation cannot overwrite ownership.
  await writeFile(path, JSON.stringify({ version: 1, name: body.name, pending: true }), { flag: 'wx', mode: 0o600 })
  let server
  try {
    ;({ server } = await api('/servers', body))
  } catch (error) {
    if (error.creationRejected === true) await unlink(path)
    throw error
  }
  output(`Created server ${server.id} (${server.name}). Startup installation is still pending.`)
  const ipIds = [server.public_net?.ipv4?.id, server.public_net?.ipv6?.id].filter(id => Number.isSafeInteger(id) && id > 0)
  await saveState(path, { version: 1, name: server.name, serverId: server.id, ipIds })
  output(`Resource IDs saved to ${path}. Destroy with: node --env-file=.env scripts/setup-hetzner.mjs --destroy --state ${path} --yes`)
  const ip = server.public_net?.ipv4?.ip
  if (ip) output(`SSH: ssh root@${ip}`)
  output('Check startup: cloud-init status --wait; sudo tail -n 100 /var/log/cloud-init-output.log')
  output(`Delete after testing in Hetzner Console: https://console.hetzner.cloud/ (server ID ${server.id}). Powering off does not stop billing.`)
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    console.log('Cleanup: --destroy previews; --destroy --yes deletes the tracked server and IPs.\n--state PATH selects local tracking (default .data/hetzner-test.json).')
    console.log(`Usage: pnpm setup:hetzner -- [options]\n\nRequires HETZNER_API_TOKEN (read/write for creation).\n  --list                List live regions, types/prices, system images and SSH keys\n  --name NAME           Test server name\n  --location NAME       Region from --list\n  --type NAME           Server type from --list\n  --image NAME          System image (default ubuntu-24.04)\n  --ssh-key NAME        Existing Hetzner SSH key name or ID\n  --install-file PATH   File containing the devpush install command\n  --create              Create a billable server (default: preview only)`)
    return
  }
  const token = process.env.HETZNER_API_TOKEN
  if (!token) throw new Error('Set HETZNER_API_TOKEN.')
  await run(options, createApi(token))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
