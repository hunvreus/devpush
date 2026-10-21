import { isValidCron } from '@/lib/backup-cron'
import { describe, expect, test } from 'vitest'
import type {
  ProjectBackupRun,
  ProjectBackupRestore,
} from '@/server/projects/types'

import {
  formatBytes,
  getBackupActivity,
  getLatestBackupRuns,
  formatBackupAge,
  formatBackupUtc,
  getComposeArtifactName,
  getSinceDate,
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
    expect(isValidCron('0 2 * * *')).toBe(true)
    expect(isValidCron('daily')).toBe(false)
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

test('history filters restores by their own status, start time and server, keeps repeated restores', () => {
  const source: ProjectBackupRun = {
    configId: null,
    localRecoveryAvailable: false,
    environmentName: 'Production',
    environmentColor: 'lime',
    serverName: 'Old server',
    errorMessage: null,
    finishedAt: null,
    id: 'b',
    status: 'succeeded',
    environmentId: 'e',
    serverId: 'old',
    createdAt: '2026-01-01',
    startedAt: null,
    artifacts: [],
  }
  const restores: ProjectBackupRestore[] = ['r1', 'r2'].map((id) => ({
    id,
    backupRunId: 'b',
    environmentId: 'e',
    serverId: 'new',
    status: 'running',
    createdAt: '2026-10-11T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }))
  const records = getBackupActivity(
    [source],
    restores,
    { type: 'restore', status: 'running', server: 'new', time: '24h' },
    new Date('2026-10-11T12:00:00Z'),
  )
  expect(records.map((row) => row.record.id)).toEqual(['r1', 'r2'])
  expect(
    getBackupActivity([{ ...source, configId: 'policy-a' }], restores, {
      policy: 'policy-a',
    }),
  ).toHaveLength(3)
  expect(
    getBackupActivity([{ ...source, configId: 'policy-a' }], restores, {
      policy: 'policy-b',
    }),
  ).toHaveLength(0)
  expect(
    getBackupActivity([source], restores, { type: 'backup' }),
  ).toHaveLength(1)
})

test('history timestamps use relative labels and explicit UTC full timestamps', () => {
  expect(
    formatBackupAge('2026-10-11T00:00:00Z', Date.parse('2026-10-11T01:00:00Z')),
  ).toBe('1h ago')
  expect(formatBackupUtc('2026-10-11T00:00:00Z')).toContain('UTC')
})

test('latest backup is chosen per policy before filtering, including failed attempts', () => {
  const run = {
    id: 'old',
    configId: 'a',
    createdAt: '2026-10-01T00:00:00Z',
  } as ProjectBackupRun
  const newer = {
    ...run,
    id: 'new',
    status: 'failed' as const,
    createdAt: '2026-10-02T00:00:00Z',
  }
  const other = { ...run, id: 'other', configId: 'b' }
  const deleted = { ...run, id: 'deleted', configId: null }
  const latest = getLatestBackupRuns([newer, run, deleted, other])
  expect([...latest.values()].map((item) => item.id)).toEqual(['new', 'other'])
})
