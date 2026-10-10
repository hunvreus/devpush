import { expect, test } from 'vitest'
import {
  backupStorageSchema,
  backupStorageReferenceSchema,
} from './backup-storage-schema'

const input = {
  name: 'Backups',
  bucket: 'my-backups',
  region: 'auto',
  endpoint: '',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
}
test('storage references contain no connection credentials', () => {
  expect(
    backupStorageReferenceSchema.parse({
      storageId: 's',
      prefix: 'project',
      secretAccessKey: 'discard',
      bucket: 'discard',
    }),
  ).toEqual({ storageId: 's', prefix: 'project' })
})
test('storage rejects injected credential lines and non-HTTP endpoints', () => {
  expect(
    backupStorageSchema.safeParse({
      ...input,
      secretAccessKey: 'secret\nregion=other',
    }).success,
  ).toBe(false)
  expect(
    backupStorageSchema.safeParse({ ...input, endpoint: 'file:///tmp/data' })
      .success,
  ).toBe(false)
  expect(
    backupStorageReferenceSchema.safeParse({ prefix: 'prefix/../elsewhere' })
      .success,
  ).toBe(false)
})
