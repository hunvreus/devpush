import { describe, expect, test } from 'vitest'

import {
  formatBytes,
  formatBackupArtifacts,
  getComposeArtifactName,
  getSinceDate,
  isCronSchedule,
} from './project-backup-utils'

describe('project backup helpers', () => {
  test('computes relative backup filter windows deterministically', () => {
    const now = new Date('2026-08-22T12:00:00.000Z')
    expect(getSinceDate('7d', now)?.toISOString()).toBe(
      '2026-08-15T12:00:00.000Z',
    )
    expect(getSinceDate(undefined, now)).toBeNull()
  })

  test('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  test('validates cron and URL input', () => {
    expect(isCronSchedule('0 2 * * *')).toBe(true)
    expect(isCronSchedule('daily')).toBe(false)
  })
})

test('Compose names strip only the current runtime prefix from volume archives', () => {
  const artifact = {
    id: 'a',
    type: 'volume' as const,
    storage: 'local' as const,
    objectKey: 'volumes/dp_90f30fdf6c_b870adad5e_test_data.tar.gz',
    checksumSha256: 'hash',
    sizeBytes: 10,
    createdAt: '2026-10-07',
  }
  expect(
    getComposeArtifactName(
      artifact,
      '90f30fdf-6c45-433a-9d2e-9779fc021e6b',
      'b870adad-5e56-41b2-9a1c-79968758bd9f',
    ),
  ).toBe('test_data')
  expect(
    getComposeArtifactName(
      artifact,
      'another-project',
      'b870adad-5e56-41b2-9a1c-79968758bd9f',
    ),
  ).toBe('dp_90f30fdf6c_b870adad5e_test_data')
})

test('backup summaries count targets once and exclude manifests', () => {
  const base = {
    id: 'a',
    checksumSha256: 'hash',
    sizeBytes: 10,
    createdAt: '2026-10-09',
  }
  expect(
    formatBackupArtifacts([
      {
        ...base,
        type: 'volume',
        storage: 'local',
        objectKey: 'volumes/data.tar.gz',
      },
      {
        ...base,
        type: 'volume',
        storage: 'remote',
        objectKey: 'prefix/volumes/data.tar.gz',
      },
      {
        ...base,
        type: 'manifest',
        storage: 'local',
        objectKey: 'manifest.json',
      },
      {
        ...base,
        type: 'manifest',
        storage: 'remote',
        objectKey: 'prefix/manifest.json',
      },
    ]),
  ).toBe('1 volume · Server + Remote')
})
