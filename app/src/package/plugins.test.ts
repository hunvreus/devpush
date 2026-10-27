import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'
import { definePlugin, generatePlugins, pluginApiVersion } from './plugins'

test('local and installed entries generate separate static server/client imports', () => {
  const root = mkdtempSync(join(tmpdir(), 'devpush-plugins-'))
  try {
    const server = join(root, 'sample.server.ts'),
      client = join(root, 'sample.ui.tsx')
    writeFileSync(server, 'export default {}')
    writeFileSync(client, 'export default {}')
    const plugin = definePlugin({
      id: 'sample',
      apiVersion: pluginApiVersion,
      runtimes: ['node', 'cloudflare'],
      server: pathToFileURL(server),
      client,
    })
    const files = generatePlugins([plugin], 'node', root)
    expect(readFileSync(files.server, 'utf8')).toContain(JSON.stringify(server))
    expect(readFileSync(files.server, 'utf8')).not.toContain(client)
    expect(readFileSync(files.client, 'utf8')).toContain(JSON.stringify(client))
    expect(readFileSync(files.client, 'utf8')).not.toContain(server)
    expect(files.client).toMatch(/plugins\.ui\.ts$/)
    expect(() => generatePlugins([plugin, plugin], 'node', root)).toThrow(
      'Duplicate plugin',
    )
    expect(() =>
      generatePlugins([{ ...plugin, runtimes: ['node'] }], 'cloudflare', root),
    ).toThrow('does not support cloudflare')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('invalid declarations fail before building the application', () => {
  expect(() =>
    definePlugin({
      id: 'Bad ID',
      apiVersion: 3,
      runtimes: ['node'],
      server: '/missing',
    }),
  ).toThrow('Plugin IDs')
  expect(() =>
    definePlugin({
      id: 'sample',
      apiVersion: 2 as 3,
      runtimes: ['node'],
      server: '/missing',
    }),
  ).toThrow('Incompatible plugin API')
  expect(() =>
    definePlugin({ id: 'sample', apiVersion: 3, runtimes: [] }),
  ).toThrow('Invalid plugin runtimes')
})

test('JavaScript declarations reject non-file entry values', () => {
  const base = { id: 'sample', apiVersion: 3, runtimes: ['node'] }
  expect(() => definePlugin({ ...base, server: true } as never)).toThrow(
    'Invalid server entry',
  )
  expect(() =>
    definePlugin({
      ...base,
      client: new URL('https://example.com/plugin.js'),
    } as never),
  ).toThrow('entries must use file URLs')
})
