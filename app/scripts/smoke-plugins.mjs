import assert from 'node:assert/strict'

export async function smokePlugins(origin) {
  if (process.env.DEVPUSH_SMOKE_PLUGINS !== '1') return
  for (const id of ['local-proof', 'npm-proof']) {
    const response = await fetch(`${origin}/api/plugins/${id}/proof`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      id,
      session: null,
      marker: `SERVER_ONLY_${id}`,
    })
  }
  assert.equal((await fetch(`${origin}/api/plugins/missing/proof`)).status, 404)
  console.log('Static local/npm plugin HTTP namespaces passed.')
}
