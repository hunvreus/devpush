import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.resolve('@tanstack/react-start'))
const { toJSONAsync, fromCrossJSON } = await import(require.resolve('seroval'))
const { defaultSerovalPlugins: plugins } = await import(
  require.resolve('@tanstack/router-core')
)

/** Call a built server function using the same transport as a browser. */
export async function createSmokeRpc({
  origin,
  headers,
  appDir,
  name,
  modulePath,
  development = false,
  bundleDir = '.output/server/_ssr',
}) {
  let functionId
  if (development) {
    const source = await (await fetch(`${origin}/${modulePath}`)).text()
    functionId = source.match(
      new RegExp(`export const ${name} = .*?createClientRpc\\("([^\\"]+)"\\)`),
    )?.[1]
  } else {
    for (const file of readdirSync(resolve(appDir, bundleDir))) {
      if (!/\.(mjs|js)$/.test(file)) continue
      const source = readFileSync(resolve(appDir, bundleDir, file), 'utf8')
      const match = source.match(
        new RegExp(`id: "([a-f0-9]+)",\\s*name: "${name}"`),
      )
      if (match) {
        functionId = match[1]
        break
      }
    }
  }
  assert.ok(functionId, `Built ${name} server function must be registered`)
  return async (data) => {
    const response = await fetch(`${origin}/_serverFn/${functionId}`, {
      method: 'POST',
      headers: {
        ...headers,
        accept: 'application/json',
        'content-type': 'application/json',
        'x-tsr-serverFn': 'true',
      },
      body: JSON.stringify(await toJSONAsync({ data }, { plugins })),
    })
    assert.match(response.headers.get('content-type'), /json/)
    return fromCrossJSON(await response.json(), { plugins })
  }
}
