import { vi } from 'vitest'
import * as ObjectStoreModule from '#devpush/server/storage/object-store'

export function mockObjectStore(entries: Array<[string, Buffer]> = []) {
  const objects = new Map(entries)
  const put = vi.fn(async (key: string, body: Uint8Array) => {
    objects.set(key, Buffer.from(body))
  })
  const remove = vi.fn(async (key: string) => {
    objects.delete(key)
  })
  const store: ObjectStoreModule.ObjectStore = {
    put,
    delete: remove,
    exists: async (key) => objects.has(key),
    get: async (key) => {
      const body = objects.get(key)
      if (!body) throw new Error('Missing test object')
      return { body }
    },
  }
  vi.spyOn(ObjectStoreModule, 'getObjectStore').mockReturnValue(store)
  return { objects, put, remove }
}
