import { expect, test, vi } from 'vitest'
import { getObjectStore, isObjectStorageConfigured } from './object-store'

const runtime = vi.hoisted<{ cloudflare: boolean; bucket: unknown }>(() => ({
  cloudflare: true,
  bucket: undefined,
}))
vi.mock('#devpush/server/config', () => ({ config: {} }))
vi.mock('#devpush/server/runtime/platform-env', () => ({
  isCloudflareRuntime: () => runtime.cloudflare,
  getR2ObjectStore: () => runtime.bucket,
}))

test('Workers uploads follow the optional bucket while Node has local storage', () => {
  expect(isObjectStorageConfigured()).toBe(false)
  runtime.bucket = {}
  expect(isObjectStorageConfigured()).toBe(true)
  runtime.bucket = undefined
  runtime.cloudflare = false
  expect(isObjectStorageConfigured()).toBe(true)
})

test('Workers reject absent storage and keep S3 transports isolated while Node reuses its store', async () => {
  runtime.cloudflare = true
  expect(() => getObjectStore()).toThrow('not configured')
  const { config } = await import('#devpush/server/config')
  Object.assign(config, {
    DEVPUSH_STORAGE_ENDPOINT: 'https://storage.example.test',
    DEVPUSH_STORAGE_BUCKET: 'avatars',
    DEVPUSH_STORAGE_ACCESS_KEY_ID: 'test-id',
    DEVPUSH_STORAGE_SECRET_ACCESS_KEY: 'test-secret',
  })
  expect(getObjectStore()).not.toBe(getObjectStore())
  runtime.cloudflare = false
  expect(getObjectStore()).toBe(getObjectStore())
})
