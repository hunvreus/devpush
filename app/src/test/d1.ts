import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { openD1 } from '#devpush/server/db/d1-connection'
import * as schema from '#devpush/server/db/schema'
import * as logSchema from '#devpush/server/db/log-schema'

export async function createD1TestStores() {
  const runtime = new Miniflare({
    workers: [
      {
        config: {
          name: 'd1-tests',
          compatibilityDate: '2026-08-29',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': {
                type: 'esm',
                contents:
                  'export default {fetch() { return new Response("test") }}',
              },
            },
          },
          env: {
            MAIN: { type: 'd1', id: 'main-test' },
            LOGS: { type: 'd1', id: 'logs-test' },
          },
        },
      },
    ],
  })
  try {
    for (const [bindingName, folder] of [
      ['MAIN', 'migrations-sqlite'],
      ['LOGS', 'migrations-logs'],
    ] as const) {
      const binding = await runtime.getD1Database(bindingName)
      const directory = fileURLToPath(
        new URL(`../server/db/${folder}/`, import.meta.url),
      )
      for (const name of readdirSync(directory)
        .filter((file) => file.endsWith('.sql'))
        .sort())
        for (const statement of readFileSync(`${directory}/${name}`, 'utf8')
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean))
          await binding.prepare(statement).run()
    }
    return {
      runtime,
      main: openD1(await runtime.getD1Database('MAIN'), schema),
      logs: openD1(await runtime.getD1Database('LOGS'), logSchema),
    }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
