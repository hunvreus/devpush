import { expect, test } from 'vitest'
import { preventAssetErrorCaching } from './node-asset-cache-plugin'

test('only prevents caching of failed asset responses', () => {
  const missing = new Response(null, { status: 404 })
  const found = new Response(null, {
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  })
  const otherError = new Response(null, { status: 404 })
  preventAssetErrorCaching(missing, new URL('https://example.com/assets/missing.js'))
  preventAssetErrorCaching(found, new URL('https://example.com/assets/app-hash.js'))
  preventAssetErrorCaching(otherError, new URL('https://example.com/missing'))
  expect(missing.headers.get('Cache-Control')).toBe('no-store')
  expect(found.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  expect(otherError.headers.has('Cache-Control')).toBe(false)
})
