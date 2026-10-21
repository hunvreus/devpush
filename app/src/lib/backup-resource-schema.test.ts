import { expect, test } from 'vitest'
import { backupResourceNameSchema } from './backup-resource-schema'
import { backupDatabaseSchema } from './backup-database'
import { backupVolumesSchema } from './backup-policy-schema'

test.each([
  '--privileged',
  '-T',
  '_leading',
  '.leading',
  'service name',
  'service\nname',
])('rejects invalid backup resource name %s across policy inputs', (name) => {
  expect(backupResourceNameSchema.safeParse(name).success).toBe(false)
  expect(
    backupDatabaseSchema.safeParse({
      service: name,
      engine: 'postgres',
      database: '',
    }).success,
  ).toBe(false)
  expect(
    backupVolumesSchema.safeParse({ mode: 'selected', names: [name] }).success,
  ).toBe(false)
})
test.each(['db', 'web-1', 'app_data', 'database.volume'])(
  'accepts Docker/Compose resource name %s',
  (name) => {
    expect(backupResourceNameSchema.safeParse(name).success).toBe(true)
  },
)
