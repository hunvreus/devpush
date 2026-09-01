import assert from 'node:assert/strict'
import test from 'node:test'

import { createGitHubApp } from './github-app.mjs'

test('protects the local manifest page with a per-run token', async () => {
  let resolveStartUrl
  const startUrlPromise = new Promise((resolve) => {
    resolveStartUrl = resolve
  })
  const creation = createGitHubApp({
    authUrl: 'https://auth.example.com',
    baseUrl: 'https://devpush.example.com',
    exchange: async (code) => {
      assert.equal(code, 'manifest-code')
      return {
        client_id: 'client-id',
        client_secret: 'client-secret',
        id: 123,
        pem: 'private-key',
        slug: 'devpush-test',
        webhook_secret: 'github-generated-webhook-secret',
      }
    },
    onAuthorize: resolveStartUrl,
    open: false,
  })

  const startUrl = await startUrlPromise
  const unprotectedUrl = new URL(startUrl)
  unprotectedUrl.search = ''
  const denied = await fetch(unprotectedUrl)
  assert.equal(denied.status, 404)

  const page = await fetch(startUrl)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.equal(html.includes('&quot;secret&quot;'), false)
  const state = html.match(/[?&]state=([a-f0-9]+)/u)?.[1]
  assert.ok(state)

  const callbackUrl = new URL('/callback', startUrl)
  callbackUrl.searchParams.set('state', state)
  callbackUrl.searchParams.set('code', 'manifest-code')
  const callback = await fetch(callbackUrl)
  assert.equal(callback.status, 200)

  const result = await creation
  assert.equal(result.values.GITHUB_APP_ID, '123')
  assert.equal(
    result.values.GITHUB_APP_WEBHOOK_SECRET,
    'github-generated-webhook-secret',
  )
  assert.equal(
    result.installUrl,
    'https://github.com/apps/devpush-test/installations/new',
  )
})
