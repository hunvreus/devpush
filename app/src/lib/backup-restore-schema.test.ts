import { expect, test } from 'vitest'
import { backupRestoreArtifactSchema } from './backup-restore-schema'

test.each(['', 'x'.repeat(129)])(
  'rejects invalid target volume length',
  (targetVolume) => {
    expect(
      backupRestoreArtifactSchema.safeParse({
        artifactId: 'a',
        type: 'volume',
        targetVolume,
      }).success,
    ).toBe(false)
  },
)
test('normalizes valid restore targets without accepting client commands', () => {
  expect(
    backupRestoreArtifactSchema.parse({
      artifactId: 'a',
      type: 'volume',
      targetVolume: ' data ',
    }),
  ).toMatchObject({ targetVolume: 'data' })
  expect(
    backupRestoreArtifactSchema.safeParse({
      artifactId: 'a',
      type: 'database',
      targetService: 'db',
      restoreCommand: ' ',
    }).success,
  ).toBe(true)
})

test.each([
  '--privileged',
  '-T',
  '../other',
  '/host',
  'db;command',
  'service name',
])('rejects restore targets that are CLI options or paths: %s', (name) => {
  expect(
    backupRestoreArtifactSchema.safeParse({
      artifactId: 'a',
      type: 'database',
      targetService: name,
    }).success,
  ).toBe(false)
  expect(
    backupRestoreArtifactSchema.safeParse({
      artifactId: 'a',
      type: 'volume',
      targetVolume: name,
    }).success,
  ).toBe(false)
})

test.each(['db', 'production-db', 'app_db.1'])(
  'accepts supported Compose and volume target names: %s',
  (name) => {
    expect(
      backupRestoreArtifactSchema.safeParse({
        artifactId: 'a',
        type: 'database',
        targetService: name,
      }).success,
    ).toBe(true)
    expect(
      backupRestoreArtifactSchema.safeParse({
        artifactId: 'a',
        type: 'volume',
        targetVolume: name,
      }).success,
    ).toBe(true)
  },
)
