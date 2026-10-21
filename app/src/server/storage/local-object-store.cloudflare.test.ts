import { expect, test } from 'vitest'
import { createLocalObjectStore } from './local-object-store.cloudflare'

test('Workers cannot silently fall back to ephemeral local storage', () => {
  expect(() => createLocalObjectStore()).toThrow(
    'Cloudflare requires an R2 binding or S3-compatible storage',
  )
})
