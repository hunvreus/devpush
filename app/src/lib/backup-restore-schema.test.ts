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
