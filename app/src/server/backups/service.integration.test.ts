import { backupConfigSchema } from '@/lib/backup-policy-schema'
import type { BackupPolicyInput } from '@/lib/backup-policy-schema'
import type { BackupStorageReference } from '@/lib/backup-storage-schema'
import { deleteProjectState } from '@/server/projects/deletion-state'
import { deleteTeamState } from '@/server/teams/deletion-state'
import { deleteServerState } from '@/server/servers/lifecycle'
import { enqueueBackupCleanup } from './queue-state'
import { getProjectContext } from '@/server/projects/context'
import { finishBackup } from '@/server/agents/backup-state'
import { buildDatabaseBackupCommand } from './database-commands'
import {
  saveBackupStorage,
  deleteBackupStorage,
  getBackupStorage,
  resolveBackupDestination,
} from './storage'
import type { BackupDestination, BackupJobPayload } from './service'
import { createHash } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'

import { closeDb, db } from '@/server/db'
import {
  agentJobs,
  backupArtifacts,
  backupStorage,
  backupConfigs,
  backupRuns,
  environments,
  projects,
  servers,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import {
  claimNextAgentJob,
  completeBackupCleanupJob,
} from '@/server/agents/jobs'
import { currentAgentCapabilities } from '@/server/agents/compatibility'
import { encryptSecret } from '@/server/secrets/crypto'
import {
  queueDueBackupSchedules,
  queueEnvironmentBackup,
  queueBackupRetentionCleanupJobs,
  queueBackupRestoreJob,
} from './service'

const touchedAgentJobIds: Array<string> = []
const touchedArtifactIds: Array<string> = []
const touchedBackupRunIds: Array<string> = []
const touchedBackupConfigIds: Array<string> = []
const touchedEnvironmentIds: Array<string> = []
const touchedProjectIds: Array<string> = []
const touchedServerIds: Array<string> = []
const touchedTeamIds: Array<string> = []
const touchedUserIds: Array<string> = []

afterEach(async () => {
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('backup service integration', () => {
  test('storage removal is scoped, refuses policies and retained files, and permits unused connections', async () => {
    const fixture = await createProjectEnvironment()
    const other = await createProjectEnvironment()
    const saved = await saveBackupStorage({
      userId: fixture.userId,
      teamSlug: fixture.teamSlug,
      input: {
        name: 'Remove test',
        bucket: 'remove-test',
        region: 'auto',
        endpoint: '',
        accessKeyId: 'test',
        secretAccessKey: 'secret',
      },
    })
    const storageId = saved[0]!.id
    const remove = () =>
      deleteBackupStorage({
        userId: fixture.userId,
        teamSlug: fixture.teamSlug,
        storageId,
      })
    await expect(
      deleteBackupStorage({
        userId: other.userId,
        teamSlug: other.teamSlug,
        storageId,
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_STORAGE_NOT_FOUND' })
    const policy = await createBackupPolicyFixture({
      enabled: true,
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      name: 'References storage',
      schedule: { cron: '0 2 * * *' },
      destination: { storageId },
      retention: {
        local: { count: 7, days: 0, maxStorageGb: 0 },
        remote: { enabled: true, count: 7, days: 0, maxStorageGb: 0 },
      },
      volumes: { mode: 'none', names: [] },
      databaseDumps: [],
    })
    const policyId = policy.id
    touchedBackupConfigIds.push(policyId)
    await expect(remove()).rejects.toThrow('cannot be removed')
    await expect(
      db.delete(backupStorage).where(eq(backupStorage.id, storageId)),
    ).rejects.toThrow('Failed query')
    await db.delete(backupConfigs).where(eq(backupConfigs.id, policyId))
    const runId = makeId('referenced-run')
    touchedBackupRunIds.push(runId)
    await db.insert(backupRuns).values({
      id: runId,
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      serverId: fixture.serverId,
      runtimeId: 'runtime',
      status: 'succeeded',
      destination: { storageId },
    })
    const artifactId = makeId('referenced-artifact')
    touchedArtifactIds.push(artifactId)
    await db.insert(backupArtifacts).values({
      id: artifactId,
      backupRunId: runId,
      type: 'volume',
      storage: 'remote',
      objectKey: 'backup.tar.gz',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1,
    })
    await expect(remove()).rejects.toThrow('cannot be removed')
    await db.delete(backupArtifacts).where(eq(backupArtifacts.id, artifactId))
    await expect(remove()).resolves.toEqual([])
    await expect(
      db.insert(backupConfigs).values({
        id: makeId('stale-policy'),
        name: 'Stale',
        projectId: fixture.projectId,
        environmentId: fixture.environmentId,
        schedule: { cron: '0 2 * * *' },
        destination: { storageId },
        retention: {},
      }),
    ).rejects.toThrow('Failed query')
  })

  test('workspace storage encrypts secrets, permits admins, rejects members and isolates other workspaces', async () => {
    const owner = await createProjectEnvironment()
    const other = await createProjectEnvironment()
    const input = {
      name: 'Shared backups',
      bucket: 'workspace-backups',
      region: 'auto',
      endpoint: 'https://s3.example.com',
      accessKeyId: 'access-key',
      secretAccessKey: 'private-secret',
    }
    const saved = await saveBackupStorage({
      userId: owner.userId,
      teamSlug: owner.teamSlug,
      input,
    })
    const storage = saved[0]!
    expect(JSON.stringify(saved)).not.toContain('private-secret')
    const stored = (
      await db
        .select()
        .from(backupStorage)
        .where(eq(backupStorage.id, storage.id))
    )[0]!
    expect(stored.secretAccessKeyCiphertext).not.toContain('private-secret')
    await expect(
      resolveBackupDestination(other.teamId, { storageId: storage.id }),
    ).rejects.toThrow('in this workspace')
    await expect(
      saveBackupStorage({
        userId: other.userId,
        teamSlug: other.teamSlug,
        input: { ...input, id: storage.id },
      }),
    ).rejects.toThrow('not found')
    await db
      .update(teamMembers)
      .set({ role: 'member' })
      .where(eq(teamMembers.teamId, owner.teamId))
    const visible = await getBackupStorage({
      userId: owner.userId,
      teamSlug: owner.teamSlug,
    })
    expect(visible[0]?.accessKeyId).toBeUndefined()
    await expect(
      saveBackupStorage({
        userId: owner.userId,
        teamSlug: owner.teamSlug,
        input,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      deleteBackupStorage({
        userId: owner.userId,
        teamSlug: owner.teamSlug,
        storageId: storage.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await db
      .update(teamMembers)
      .set({ role: 'admin' })
      .where(eq(teamMembers.teamId, owner.teamId))
    await expect(
      saveBackupStorage({
        userId: owner.userId,
        teamSlug: owner.teamSlug,
        input: {
          ...input,
          id: storage.id,
          name: 'Renamed',
          secretAccessKey: '',
        },
      }),
    ).resolves.toMatchObject([{ name: 'Renamed' }])
    await expect(
      saveBackupStorage({
        userId: owner.userId,
        teamSlug: owner.teamSlug,
        input: { ...input, id: storage.id, bucket: 'other-bucket' },
      }),
    ).rejects.toThrow('Create another')
  })

  test('a malformed retained policy does not abort maintenance', async () => {
    const f = await createProjectEnvironment()
    const policy = await createBackupPolicyFixture({
      projectId: f.projectId,
      environmentId: f.environmentId,
      enabled: true,
      destination: { bucket: 'integration-backups' },
    })
    touchedBackupConfigIds.push(policy.id)
    await db
      .update(backupConfigs)
      .set({ retention: {} })
      .where(eq(backupConfigs.id, policy.id))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(
        queueBackupRetentionCleanupJobs({ projectId: f.projectId }),
      ).resolves.toEqual([])
      expect(logged).toHaveBeenCalledWith(
        'Skipping backup retention policy with invalid settings.',
        { policyId: policy.id },
      )
    } finally {
      logged.mockRestore()
    }
  })

  test('remote restore and retention keep the original destination after policy replacement and use rotated credentials', async () => {
    const fixture = await createProjectEnvironment()
    const input = {
      name: 'Original',
      bucket: 'original-bucket',
      region: 'us-east-1',
      endpoint: '',
      accessKeyId: 'original-key',
      secretAccessKey: 'original-secret',
    }
    const storage = (
      await saveBackupStorage({
        userId: fixture.userId,
        teamSlug: fixture.teamSlug,
        input,
      })
    )[0]!
    const policy = await createBackupPolicyFixture({
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      enabled: true,
      destination: { storageId: storage.id, prefix: 'original' },
      retention: {
        local: { count: 0, days: 0, maxStorageGb: 0 },
        remote: { enabled: true, count: 0, days: 1, maxStorageGb: 0 },
      },
    })
    touchedBackupConfigIds.push(policy.id)
    const queued = (await queueEnvironmentBackup({
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      backupConfigId: policy.id,
    }))!
    touchedAgentJobIds.push(queued.agentJobId)
    touchedBackupRunIds.push(queued.backupRunId)
    await db
      .update(backupRuns)
      .set({ status: 'succeeded', finishedAt: new Date('2026-01-01') })
      .where(eq(backupRuns.id, queued.backupRunId))
    const artifacts = await db
      .insert(backupArtifacts)
      .values({
        id: crypto.randomUUID(),
        backupRunId: queued.backupRunId,
        type: 'volume',
        storage: 'remote',
        objectKey: 'original/data.tar.gz',
        checksumSha256: 'a'.repeat(64),
        sizeBytes: 10,
      })
      .returning({ id: backupArtifacts.id })
    touchedArtifactIds.push(...artifacts.map((item) => item.id))
    const newer = (
      await saveBackupStorage({
        userId: fixture.userId,
        teamSlug: fixture.teamSlug,
        input: { ...input, name: 'New bucket', bucket: 'new-bucket' },
      })
    ).find((item) => item.bucket === 'new-bucket')!
    await db
      .update(backupConfigs)
      .set({ destination: { storageId: newer.id } })
      .where(eq(backupConfigs.id, policy.id))
    await saveBackupStorage({
      userId: fixture.userId,
      teamSlug: fixture.teamSlug,
      input: {
        ...input,
        id: storage.id,
        accessKeyId: 'rotated-key',
        secretAccessKey: 'rotated-secret',
      },
    })
    const restored = await queueBackupRestoreJob({
      projectId: fixture.projectId,
      backupRunId: queued.backupRunId,
      artifacts: [
        { artifactId: artifacts[0]!.id, type: 'volume', targetVolume: 'data' },
      ],
    })
    touchedAgentJobIds.push(restored.agentJobId)
    const context = await getProjectContext({
      userId: fixture.userId,
      teamSlug: fixture.teamSlug,
      projectName: makeSlug(fixture.projectId),
      scope: 'backups',
    })
    const details = context.backupRestores.find(
      (item) => item.id === restored.agentJobId,
    )!
    expect(details.artifacts).toEqual([
      {
        artifactId: artifacts[0]!.id,
        type: 'volume',
        targetVolume: 'data',
        targetService: undefined,
      },
    ])
    expect(details).not.toHaveProperty('destination')
    expect(details.artifacts![0]).not.toHaveProperty('objectKey')
    expect(restored.payload.destination).toMatchObject({
      bucket: 'original-bucket',
      storageId: storage.id,
    })
    const restoreClaim = await claimNextAgentJob({
      serverId: fixture.serverId,
      token: fixture.token,
      protocolVersion: 1,
      capabilities: ['jobs.restore.v1'],
    })
    expect(restoreClaim).toMatchObject({
      type: 'restore',
      id: restored.agentJobId,
      restore: {
        destination: {
          bucket: 'original-bucket',
          accessKeyId: 'rotated-key',
          secretAccessKey: 'rotated-secret',
        },
      },
    })
    const cleanup = await queueBackupRetentionCleanupJobs({
      projectId: fixture.projectId,
      now: new Date(),
    })
    touchedAgentJobIds.push(...cleanup.map((item) => item.id))
    const cleanupJob = (
      await db.select().from(agentJobs).where(eq(agentJobs.id, cleanup[0]!.id))
    )[0]!
    expect(cleanupJob.payload).toMatchObject({
      destination: { bucket: 'original-bucket', storageId: storage.id },
    })
    const cleanupClaim = await claimNextAgentJob({
      serverId: fixture.serverId,
      token: fixture.token,
      protocolVersion: 1,
      capabilities: ['jobs.backup.cleanup.v1'],
    })
    expect(cleanupClaim).toMatchObject({
      type: 'backup_cleanup',
      cleanup: {
        destination: {
          bucket: 'original-bucket',
          accessKeyId: 'rotated-key',
          secretAccessKey: 'rotated-secret',
        },
      },
    })
    // A subsequent restore is permitted after the earlier restore completes;
    // simultaneous restores for one runtime are rejected by queue admission.
    await db
      .update(agentJobs)
      .set({ status: 'succeeded', finishedAt: new Date() })
      .where(eq(agentJobs.id, restored.agentJobId))
    await db.delete(backupConfigs).where(eq(backupConfigs.id, policy.id))
    const afterDelete = await queueBackupRestoreJob({
      projectId: fixture.projectId,
      backupRunId: queued.backupRunId,
      artifacts: [
        { artifactId: artifacts[0]!.id, type: 'volume', targetVolume: 'data' },
      ],
    })
    touchedAgentJobIds.push(afterDelete.agentJobId)
    expect(afterDelete.payload.destination?.bucket).toBe('original-bucket')
  })

  test('manual backup selection uses the requested policy when an environment has multiple destinations', async () => {
    const fixture = await createProjectEnvironment()
    const input = {
      name: 'First',
      bucket: 'first-bucket',
      region: 'auto',
      endpoint: '',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    }
    const first = (
      await saveBackupStorage({
        userId: fixture.userId,
        teamSlug: fixture.teamSlug,
        input,
      })
    )[0]!
    const second = (
      await saveBackupStorage({
        userId: fixture.userId,
        teamSlug: fixture.teamSlug,
        input: { ...input, name: 'Second', bucket: 'second-bucket' },
      })
    ).find((item) => item.bucket === 'second-bucket')!
    const policy = await createBackupPolicyFixture({
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      enabled: true,
      destination: { storageId: first.id },
      retention: {
        local: { count: 7, days: 0, maxStorageGb: 0 },
        remote: { enabled: true, count: 7, days: 0, maxStorageGb: 0 },
      },
    })
    const stored = (
      await db
        .select()
        .from(backupConfigs)
        .where(eq(backupConfigs.id, policy.id))
    )[0]!
    const secondId = crypto.randomUUID()
    touchedBackupConfigIds.push(policy.id, secondId)
    await db.insert(backupConfigs).values({
      ...stored,
      id: secondId,
      destination: { storageId: second.id },
    })
    let ambiguityError: unknown
    try {
      const unexpected = await queueEnvironmentBackup({
        projectId: fixture.projectId,
        environmentId: fixture.environmentId,
      })
      if (unexpected) {
        touchedAgentJobIds.push(unexpected.agentJobId)
        touchedBackupRunIds.push(unexpected.backupRunId)
      }
    } catch (error) {
      ambiguityError = error
    }
    expect(ambiguityError).toMatchObject({ code: 'BACKUP_POLICY_REQUIRED' })
    const queued = (await queueEnvironmentBackup({
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      backupConfigId: secondId,
    }))!
    touchedAgentJobIds.push(queued.agentJobId)
    touchedBackupRunIds.push(queued.backupRunId)
    expect(queued.payload.destination.bucket).toBe('second-bucket')
    const run = (
      await db
        .select()
        .from(backupRuns)
        .where(eq(backupRuns.id, queued.backupRunId))
    )[0]!
    expect(run.configId).toBe(secondId)
  })

  test('queues and claims backup agent jobs', async () => {
    const { environmentId, projectId, serverId, token } =
      await createProjectEnvironment()

    const config = await createBackupPolicyFixture({
      projectId,
      environmentId,
      enabled: true,
      destination: {
        bucket: 'devpush-backups',
        prefix: 'backups',
      },
      databaseDumps: [
        {
          service: 'postgres',
          engine: 'postgres',
          database: '',
        },
      ],
    })
    touchedBackupConfigIds.push(config.id)

    const queued = await queueEnvironmentBackup({
      projectId,
      environmentId,
      manifest: {
        schemaVersion: 1,
      },
    })
    expect(queued).not.toBeNull()
    if (!queued) throw new Error('Backup was not queued.')
    touchedBackupRunIds.push(queued.backupRunId)
    touchedAgentJobIds.push(queued.agentJobId)

    const [jobRows, runRows] = await Promise.all([
      db
        .select({
          id: agentJobs.id,
          type: agentJobs.type,
          status: agentJobs.status,
          payload: agentJobs.payload,
        })
        .from(agentJobs)
        .where(inArray(agentJobs.id, [queued.agentJobId])),
      db
        .select({
          id: backupRuns.id,
          status: backupRuns.status,
          runtimeId: backupRuns.runtimeId,
        })
        .from(backupRuns)
        .where(inArray(backupRuns.id, [queued.backupRunId])),
    ])

    await expect(claimNextAgentJob({ serverId, token })).resolves.toBeNull()

    const claimedJob = await claimNextAgentJob({
      serverId,
      token,
      protocolVersion: 1,
      capabilities: [...currentAgentCapabilities],
    })

    expect(jobRows).toHaveLength(1)
    expect(jobRows[0]).toMatchObject({
      id: queued.agentJobId,
      type: 'backup',
      status: 'queued',
      payload: {
        schemaVersion: 1,
        backupRunId: queued.backupRunId,
        artifactPrefix: `backups/runs/${queued.backupRunId}`,
        localBasePath: `/var/lib/devpush-agent/backups/${projectId}/${environmentId}/${queued.backupRunId}`,
        projectId,
        environmentId,
        runtimeId: 'dp_project_production',
        destination: { bucket: 'local-backups', prefix: 'backups' },
        databaseDumps: [
          {
            service: 'postgres',
            command: buildDatabaseBackupCommand({
              service: 'postgres',
              engine: 'postgres',
              database: '',
            }),
            format: 'sql',
          },
        ],
      },
    })
    expect(runRows).toEqual([
      {
        id: queued.backupRunId,
        status: 'queued',
        runtimeId: 'dp_project_production',
      },
    ])
    expect(claimedJob).toMatchObject({
      type: 'backup',
      id: queued.agentJobId,
      backup: {
        backupRunId: queued.backupRunId,
        artifactPrefix: `backups/runs/${queued.backupRunId}`,
        localBasePath: `/var/lib/devpush-agent/backups/${projectId}/${environmentId}/${queued.backupRunId}`,
      },
    })
  })

  test('restore retains the original engine and scope across completion and policy edits', async () => {
    const { environmentId, projectId, serverId } =
      await createProjectEnvironment()
    const targets = [
      { service: 'db', engine: 'postgres' as const, database: 'original' },
    ]
    const config = await createBackupPolicyFixture({
      projectId,
      environmentId,
      enabled: true,
      destination: { bucket: 'local-backups' },
      databaseDumps: targets,
    })
    touchedBackupConfigIds.push(config.id)
    const queued = await queueEnvironmentBackup({ projectId, environmentId })
    if (!queued) throw new Error('Not queued')
    touchedBackupRunIds.push(queued.backupRunId)
    touchedAgentJobIds.push(queued.agentJobId)
    await db
      .update(agentJobs)
      .set({ status: 'running' })
      .where(eq(agentJobs.id, queued.agentJobId))
    await db
      .update(backupRuns)
      .set({ status: 'running' })
      .where(eq(backupRuns.id, queued.backupRunId))
    await finishBackup(db, {
      serverId,
      now: new Date(),
      errorMessage: null,
      manifest: {
        databaseTargets: [
          { service: 'malicious', engine: 'mongo', database: 'other' },
        ],
        schemaVersion: 1,
      },
      completion: {
        jobId: queued.agentJobId,
        backupRunId: queued.backupRunId,
        status: 'succeeded',
        artifacts: [
          {
            type: 'database',
            storage: 'local',
            objectKey: '/backup/databases/01-db.sql.gz',
            checksumSha256: 'a'.repeat(64),
            sizeBytes: 100,
          },
        ],
      },
    })
    await db
      .update(backupConfigs)
      .set({
        databaseDumps: [
          { service: 'db', engine: 'mysql', database: 'changed' },
        ],
      })
      .where(eq(backupConfigs.id, config.id))
    const [artifact] = await db
      .select()
      .from(backupArtifacts)
      .where(eq(backupArtifacts.backupRunId, queued.backupRunId))
    touchedArtifactIds.push(artifact!.id)
    const restored = await queueBackupRestoreJob({
      projectId,
      backupRunId: queued.backupRunId,
      artifacts: [
        { artifactId: artifact!.id, type: 'database', targetService: 'new-db' },
      ],
    })
    touchedAgentJobIds.push(restored.agentJobId)
    const [job] = await db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.id, restored.agentJobId))
    expect(JSON.stringify(job!.payload)).toContain('psql')
    expect(JSON.stringify(job!.payload)).toContain("--dbname='original'")
    expect(JSON.stringify(job!.payload)).not.toContain('changed')
  })

  test('persists no credential copies and loads rotated secrets when the agent claims a job', async () => {
    const { environmentId, projectId, serverId, token } =
      await createProjectEnvironment()
    const rawSecret = `remote-secret-${crypto.randomUUID()}`
    const config = await createBackupPolicyFixture({
      projectId,
      environmentId,
      enabled: true,
      destination: {
        bucket: 'devpush-backups',
        accessKeyId: 'remote-access-key',
        secretAccessKeyCiphertext: encryptSecret(rawSecret),
      },
      retention: {
        local: { count: 7, days: 0, maxStorageGb: 0 },
        remote: { enabled: true, count: 7, days: 0, maxStorageGb: 0 },
      },
    })
    touchedBackupConfigIds.push(config.id)

    const queued = await queueEnvironmentBackup({ projectId, environmentId })
    expect(queued).not.toBeNull()
    if (!queued) throw new Error('Backup was not queued.')
    touchedBackupRunIds.push(queued.backupRunId)
    touchedAgentJobIds.push(queued.agentJobId)

    const stored = await db
      .select({ payload: agentJobs.payload })
      .from(agentJobs)
      .where(eq(agentJobs.id, queued.agentJobId))
    expect(JSON.stringify(stored[0]?.payload)).not.toContain(rawSecret)

    expect(stored[0]?.payload).toMatchObject({
      destination: { storageId: config.destination.storageId },
    })
    expect(JSON.stringify(stored[0]?.payload)).not.toContain(
      'secretAccessKeyCiphertext',
    )
    expect(JSON.stringify(stored[0]?.payload)).not.toContain('accessKeyId')
    const [run] = await db
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.id, queued.backupRunId))
    expect(JSON.stringify(run?.destination)).not.toContain(
      'secretAccessKeyCiphertext',
    )
    const rotatedSecret = `rotated-${crypto.randomUUID()}`
    await db
      .update(backupStorage)
      .set({
        accessKeyId: 'rotated-after-queue',
        secretAccessKeyCiphertext: encryptSecret(rotatedSecret),
      })
      .where(eq(backupStorage.id, config.destination.storageId))

    const claimed = await claimNextAgentJob({
      serverId,
      token,
      protocolVersion: 1,
      capabilities: [...currentAgentCapabilities],
    })
    expect(claimed).toMatchObject({
      backup: {
        destination: {
          accessKeyId: 'rotated-after-queue',
          secretAccessKey: rotatedSecret,
        },
      },
    })
    expect(JSON.stringify(claimed)).not.toContain('secretAccessKeyCiphertext')
  })

  test('fails backup jobs whose agent completion never arrives', async () => {
    const { environmentId, projectId, serverId, token } =
      await createProjectEnvironment()
    const config = await createBackupPolicyFixture({
      projectId,
      environmentId,
      enabled: true,
      destination: { bucket: 'devpush-backups' },
    })
    touchedBackupConfigIds.push(config.id)
    const queued = await queueEnvironmentBackup({ projectId, environmentId })
    expect(queued).not.toBeNull()
    if (!queued) throw new Error('Backup was not queued.')
    touchedBackupRunIds.push(queued.backupRunId)
    touchedAgentJobIds.push(queued.agentJobId)
    const claimedAt = new Date(Date.now() - 26 * 60 * 60 * 1000)

    await Promise.all([
      db
        .update(agentJobs)
        .set({ status: 'running', claimedAt })
        .where(eq(agentJobs.id, queued.agentJobId)),
      db
        .update(backupRuns)
        .set({ status: 'running', startedAt: claimedAt })
        .where(eq(backupRuns.id, queued.backupRunId)),
    ])

    await expect(
      claimNextAgentJob({
        serverId,
        token,
        protocolVersion: 1,
        capabilities: [...currentAgentCapabilities],
      }),
    ).resolves.toBeNull()

    await expect(
      Promise.all([
        db
          .select({ status: agentJobs.status })
          .from(agentJobs)
          .where(eq(agentJobs.id, queued.agentJobId)),
        db
          .select({ status: backupRuns.status })
          .from(backupRuns)
          .where(eq(backupRuns.id, queued.backupRunId)),
      ]),
    ).resolves.toEqual([[{ status: 'failed' }], [{ status: 'failed' }]])
  })

  test('queues retention cleanup jobs once for expired backups', async () => {
    const { environmentId, projectId, serverId } =
      await createProjectEnvironment()
    const config = await createBackupPolicyFixture({
      projectId,
      environmentId,
      enabled: true,
      destination: {
        bucket: 'devpush-backups',
        prefix: 'backups',
      },
      retention: {
        local: {
          count: 1,
          days: 0,
          maxStorageGb: 0,
        },
        remote: {
          enabled: true,
          count: 1,
          days: 0,
          maxStorageGb: 0,
        },
      },
    })
    touchedBackupConfigIds.push(config.id)

    const newestRunId = makeId('backup-run-newest')
    const expiredRunId = makeId('backup-run-expired')
    touchedBackupRunIds.push(newestRunId, expiredRunId)
    await db.insert(backupRuns).values([
      {
        id: newestRunId,
        projectId,
        environmentId,
        serverId,
        runtimeId: 'dp_project_production',
        status: 'succeeded',
        destination: {
          bucket: 'devpush-backups',
          prefix: 'backups',
          accessKeyId: 'test-key',
          storageId: config.destination.storageId,
        },
        finishedAt: new Date('2026-06-20T12:00:00.000Z'),
      },
      {
        id: expiredRunId,
        projectId,
        environmentId,
        serverId,
        runtimeId: 'dp_project_production',
        status: 'succeeded',
        destination: {
          bucket: 'devpush-backups',
          prefix: 'backups',
          accessKeyId: 'test-key',
          storageId: config.destination.storageId,
        },
        finishedAt: new Date('2026-06-19T12:00:00.000Z'),
      },
    ])
    const artifactId = makeId('artifact')
    touchedArtifactIds.push(artifactId)
    await db.insert(backupArtifacts).values({
      id: artifactId,
      backupRunId: expiredRunId,
      type: 'manifest',
      storage: 'remote',
      objectKey: 'backups/expired/manifest.json',
      checksumSha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      sizeBytes: 512,
    })

    const newestArtifactId = makeId('newest-artifact')
    touchedArtifactIds.push(newestArtifactId)
    await db.insert(backupArtifacts).values({
      id: newestArtifactId,
      backupRunId: newestRunId,
      type: 'manifest',
      storage: 'remote',
      objectKey: 'backups/newest/manifest.json',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 512,
    })

    const queued = await queueBackupRetentionCleanupJobs({
      projectId,
      environmentId,
      now: new Date('2026-06-21T00:00:00.000Z'),
    })
    touchedAgentJobIds.push(...queued.map((job) => job.id))
    const queuedAgain = await queueBackupRetentionCleanupJobs({
      projectId,
      environmentId,
      now: new Date('2026-06-21T00:01:00.000Z'),
    })

    const [jobRows, runRows] = await Promise.all([
      db
        .select({
          id: agentJobs.id,
          type: agentJobs.type,
          status: agentJobs.status,
          payload: agentJobs.payload,
        })
        .from(agentJobs)
        .where(
          inArray(
            agentJobs.id,
            queued.map((job) => job.id),
          ),
        ),
      db
        .select({
          id: backupRuns.id,
          cleanupQueuedAt: backupRuns.cleanupQueuedAt,
        })
        .from(backupRuns)
        .where(inArray(backupRuns.id, [newestRunId, expiredRunId])),
    ])

    expect(queued).toEqual([
      { id: expect.any(String), backupRunIds: [expiredRunId] },
    ])
    expect(queuedAgain).toEqual([])
    expect(jobRows).toHaveLength(1)
    expect(jobRows[0]).toMatchObject({
      type: 'backup_cleanup',
      status: 'queued',
      payload: {
        schemaVersion: 1,
        backupRunIds: [expiredRunId],
        destination: {
          bucket: 'devpush-backups',
          prefix: 'backups',
        },
        localObjectKeys: [],
        remoteObjectKeys: ['backups/expired/manifest.json'],
      },
    })
    expect(
      runRows.find((run) => run.id === expiredRunId)?.cleanupQueuedAt,
    ).toBeInstanceOf(Date)
    expect(
      runRows.find((run) => run.id === newestRunId)?.cleanupQueuedAt,
    ).toBeNull()
  })

  test('applies remote retention after earlier local cleanup', async () => {
    const { environmentId, projectId, serverId, token } =
      await createProjectEnvironment()
    const config = await createBackupPolicyFixture({
      projectId,
      environmentId,
      enabled: true,
      destination: { bucket: 'devpush-backups', prefix: 'backups' },
      retention: {
        local: { count: 1, days: 0, maxStorageGb: 0 },
        remote: { enabled: true, count: 0, days: 10, maxStorageGb: 0 },
      },
    })
    touchedBackupConfigIds.push(config.id)

    const newestRunId = makeId('backup-run-newest-tiered')
    const olderRunId = makeId('backup-run-older-tiered')
    touchedBackupRunIds.push(newestRunId, olderRunId)
    await db.insert(backupRuns).values([
      {
        id: newestRunId,
        projectId,
        environmentId,
        serverId,
        runtimeId: 'dp_project_production',
        status: 'succeeded',
        destination: {
          bucket: 'devpush-backups',
          prefix: 'backups',
          accessKeyId: 'test-key',
          storageId: config.destination.storageId,
        },
        finishedAt: new Date('2026-06-20T12:00:00.000Z'),
      },
      {
        id: olderRunId,
        projectId,
        environmentId,
        serverId,
        runtimeId: 'dp_project_production',
        status: 'succeeded',
        destination: {
          bucket: 'devpush-backups',
          prefix: 'backups',
          accessKeyId: 'test-key',
          storageId: config.destination.storageId,
        },
        finishedAt: new Date('2026-06-19T12:00:00.000Z'),
      },
    ])
    const localArtifactId = makeId('artifact-local-tiered')
    const remoteArtifactId = makeId('artifact-remote-tiered')
    touchedArtifactIds.push(localArtifactId, remoteArtifactId)
    await db.insert(backupArtifacts).values([
      {
        id: localArtifactId,
        backupRunId: olderRunId,
        type: 'manifest',
        storage: 'local',
        objectKey: `/var/lib/devpush-agent/backups/${olderRunId}/manifest.json`,
        checksumSha256: 'a'.repeat(64),
        sizeBytes: 1,
      },
      {
        id: remoteArtifactId,
        backupRunId: olderRunId,
        type: 'manifest',
        storage: 'remote',
        objectKey: `backups/${olderRunId}/manifest.json`,
        checksumSha256: 'b'.repeat(64),
        sizeBytes: 1,
      },
    ])

    const newestArtifactId = makeId('newest-local-artifact')
    touchedArtifactIds.push(newestArtifactId)
    await db.insert(backupArtifacts).values({
      id: newestArtifactId,
      backupRunId: newestRunId,
      type: 'manifest',
      storage: 'local',
      objectKey: `/var/lib/devpush-agent/backups/${newestRunId}/manifest.json`,
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1,
    })

    const localJobs = await queueBackupRetentionCleanupJobs({
      projectId,
      environmentId,
      now: new Date('2026-06-21T00:00:00.000Z'),
    })
    touchedAgentJobIds.push(...localJobs.map((job) => job.id))
    expect(localJobs).toEqual([
      { id: expect.any(String), backupRunIds: [olderRunId] },
    ])
    await db
      .update(agentJobs)
      .set({ status: 'running' })
      .where(eq(agentJobs.id, localJobs[0]?.id ?? ''))
    await completeBackupCleanupJob({
      serverId,
      token,
      completion: {
        jobId: localJobs[0]?.id ?? '',
        backupRunIds: [olderRunId],
        status: 'succeeded',
      },
    })

    const remoteJobs = await queueBackupRetentionCleanupJobs({
      projectId,
      environmentId,
      now: new Date('2026-06-30T00:00:00.000Z'),
    })
    touchedAgentJobIds.push(...remoteJobs.map((job) => job.id))
    expect(remoteJobs).toEqual([
      { id: expect.any(String), backupRunIds: [olderRunId] },
    ])
  })

  test.each(['succeeded', 'failed'] as const)(
    'queues restore jobs for recoverable %s backup artifacts',
    async (status) => {
      const { environmentId, projectId, serverId } =
        await createProjectEnvironment()
      const backupRunId = makeId('backup-run-restore')
      const artifactId = makeId('artifact-restore-volume')
      touchedBackupRunIds.push(backupRunId)
      touchedArtifactIds.push(artifactId)
      await db.insert(backupRuns).values({
        id: backupRunId,
        projectId,
        environmentId,
        serverId,
        runtimeId: 'dp_project_production',
        status,
        manifest: status === 'failed' ? { localRecoveryAvailable: true } : null,
        finishedAt: new Date('2026-06-20T12:00:00.000Z'),
      })
      await db.insert(backupArtifacts).values({
        id: artifactId,
        backupRunId,
        type: 'volume',
        storage: 'local',
        objectKey:
          '/var/lib/devpush-agent/backups/run/volumes/postgres-data.tar.gz',
        checksumSha256:
          'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        sizeBytes: 1024,
      })

      const queued = await queueBackupRestoreJob({
        projectId,
        backupRunId,
        artifacts: [
          {
            artifactId,
            type: 'volume',
            targetVolume: 'postgres-data',
          },
        ],
      })
      touchedAgentJobIds.push(queued.agentJobId)

      const jobRows = await db
        .select({
          id: agentJobs.id,
          type: agentJobs.type,
          status: agentJobs.status,
          payload: agentJobs.payload,
        })
        .from(agentJobs)
        .where(inArray(agentJobs.id, [queued.agentJobId]))

      expect(jobRows).toEqual([
        {
          id: queued.agentJobId,
          type: 'restore',
          status: 'queued',
          payload: {
            schemaVersion: 1,
            backupRunId,
            projectId,
            environmentId,
            runtimeId: 'dp_project_production',
            artifacts: [
              {
                id: artifactId,
                type: 'volume',
                storage: 'local',
                objectKey:
                  '/var/lib/devpush-agent/backups/run/volumes/postgres-data.tar.gz',
                checksumSha256:
                  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                targetVolume: 'postgres-data',
              },
            ],
          },
        },
      ])
    },
  )

  test.each(['succeeded', 'failed'] as const)(
    'queues local retention cleanup for %s backups without remote cleanup',
    async (status) => {
      const { environmentId, projectId, serverId } =
        await createProjectEnvironment()
      const config = await createBackupPolicyFixture({
        projectId,
        environmentId,
        enabled: true,
        destination: {
          bucket: 'devpush-backups',
          prefix: 'backups',
        },
        retention: {
          local: {
            count: 1,
            days: 0,
            maxStorageGb: 0,
          },
          remote: {
            enabled: false,
            count: 1,
            days: 0,
            maxStorageGb: 0,
          },
        },
      })
      touchedBackupConfigIds.push(config.id)

      const backupRunIds = [
        makeId('backup-run-newest-disabled-remote'),
        makeId('backup-run-expired-disabled-remote'),
      ] as const
      touchedBackupRunIds.push(...backupRunIds)
      await db.insert(backupRuns).values([
        {
          id: backupRunIds[0],
          projectId,
          environmentId,
          serverId,
          runtimeId: 'dp_project_production',
          status,
          manifest:
            status === 'failed' ? { localRecoveryAvailable: true } : null,
          destination: {
            bucket: 'devpush-backups',
            prefix: 'backups',
            accessKeyId: 'test-key',
            storageId: config.destination.storageId,
          },
          finishedAt: new Date('2026-06-20T12:00:00.000Z'),
        },
        {
          id: backupRunIds[1],
          projectId,
          environmentId,
          serverId,
          runtimeId: 'dp_project_production',
          status,
          manifest:
            status === 'failed' ? { localRecoveryAvailable: true } : null,
          destination: {
            bucket: 'devpush-backups',
            prefix: 'backups',
            accessKeyId: 'test-key',
            storageId: config.destination.storageId,
          },
          finishedAt: new Date('2026-06-19T12:00:00.000Z'),
        },
      ])
      const artifactId = makeId('artifact-disabled-remote')
      touchedArtifactIds.push(artifactId)
      await db.insert(backupArtifacts).values({
        id: artifactId,
        backupRunId: backupRunIds[1],
        type: 'manifest',
        storage: 'local',
        objectKey: '/var/lib/devpush-agent/backups/expired/manifest.json',
        checksumSha256:
          'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        sizeBytes: 512,
      })

      const newestArtifactId = makeId('newest-local-artifact')
      touchedArtifactIds.push(newestArtifactId)
      await db.insert(backupArtifacts).values({
        id: newestArtifactId,
        backupRunId: backupRunIds[0],
        type: 'manifest',
        storage: 'local',
        objectKey: '/var/lib/devpush-agent/backups/newest/manifest.json',
        checksumSha256: 'a'.repeat(64),
        sizeBytes: 512,
      })

      const queued = await queueBackupRetentionCleanupJobs({
        projectId,
        environmentId,
        now: new Date('2026-06-21T00:00:00.000Z'),
      })

      expect(queued).toEqual([
        { id: expect.any(String), backupRunIds: [backupRunIds[1]] },
      ])
      touchedAgentJobIds.push(...queued.map((job) => job.id))
    },
  )

  test('failed local-only uploads do not expire the last remote recovery point', async () => {
    const { projectId, environmentId, serverId } =
      await createProjectEnvironment()
    const config = await createBackupPolicyFixture({
      projectId,
      environmentId,
      enabled: true,
      destination: { bucket: 'backups' },
      retention: {
        local: { count: 1, days: 0, maxStorageGb: 0 },
        remote: { enabled: true, count: 1, days: 0, maxStorageGb: 0 },
      },
    })
    touchedBackupConfigIds.push(config.id)
    const failedId = makeId('failed-upload'),
      successfulId = makeId('successful-upload')
    touchedBackupRunIds.push(failedId, successfulId)
    await db.insert(backupRuns).values([
      {
        id: failedId,
        projectId,
        environmentId,
        serverId,
        configId: config.id,
        runtimeId: 'runtime',
        status: 'failed',
        manifest: { localRecoveryAvailable: true },
        finishedAt: new Date('2026-06-21'),
      },
      {
        id: successfulId,
        projectId,
        environmentId,
        serverId,
        configId: config.id,
        runtimeId: 'runtime',
        status: 'succeeded',
        destination: {
          bucket: 'backups',
          accessKeyId: 'key',
          secretAccessKeyCiphertext: encryptSecret('secret'),
        },
        finishedAt: new Date('2026-06-20'),
      },
    ])
    const artifacts = [
      {
        id: makeId('artifact'),
        backupRunId: failedId,
        storage: 'local' as const,
        objectKey: '/var/lib/devpush-agent/backups/new/manifest.json',
      },
      {
        id: makeId('artifact'),
        backupRunId: successfulId,
        storage: 'remote' as const,
        objectKey: 'old/manifest.json',
      },
    ]
    touchedArtifactIds.push(...artifacts.map((a) => a.id))
    await db.insert(backupArtifacts).values(
      artifacts.map((a) => ({
        ...a,
        type: 'manifest' as const,
        sizeBytes: 1,
        checksumSha256: 'a'.repeat(64),
      })),
    )
    expect(
      await queueBackupRetentionCleanupJobs({
        projectId,
        environmentId,
        now: new Date('2026-06-22'),
      }),
    ).toEqual([])
  })

  test('queues due backup schedules', async () => {
    const { environmentId, projectId } = await createProjectEnvironment()
    const config = await createBackupPolicyFixture({
      projectId,
      environmentId,
      enabled: true,
      schedule: { cron: '30 2 * * *' },
      destination: {
        bucket: 'devpush-backups',
      },
    })
    touchedBackupConfigIds.push(config.id)

    const queued = await queueDueBackupSchedules({
      now: new Date('2030-07-09T02:30:00.000Z'),
    })
    touchedBackupRunIds.push(...queued.map((job) => job.backupRunId))
    touchedAgentJobIds.push(...queued.map((job) => job.agentJobId))

    expect(queued).toEqual([
      {
        backupRunId: expect.any(String),
        agentJobId: expect.any(String),
      },
    ])

    await expect(
      queueDueBackupSchedules({
        now: new Date('2030-07-09T02:30:45.000Z'),
      }),
    ).resolves.toEqual([])
  })

  test('does not queue backups for deleted servers', async () => {
    const { environmentId, projectId, serverId } =
      await createProjectEnvironment()
    const config = await createBackupPolicyFixture({
      projectId,
      environmentId,
      enabled: true,
      schedule: { cron: '30 2 * * *' },
      destination: { bucket: 'devpush-backups' },
    })
    touchedBackupConfigIds.push(config.id)
    await db
      .update(servers)
      .set({ status: 'deleted' })
      .where(eq(servers.id, serverId))

    await expect(
      queueEnvironmentBackup({ projectId, environmentId }),
    ).rejects.toThrow('Enabled backup configuration not found.')
    await expect(
      queueDueBackupSchedules({
        now: new Date('2030-07-09T02:30:00.000Z'),
      }),
    ).resolves.toEqual([])
  })
})

test.each(['project', 'team', 'server'] as const)(
  '%s deletion releases canceled backup-cleanup reservations',
  async (kind) => {
    const f = await createProjectEnvironment()
    const runId = makeId('reserved-run'),
      jobId = makeId('cleanup-job')
    touchedBackupRunIds.push(runId)
    touchedAgentJobIds.push(jobId)
    const now = new Date()
    await db.insert(backupRuns).values({
      id: runId,
      projectId: f.projectId,
      environmentId: f.environmentId,
      serverId: f.serverId,
      runtimeId: 'dp_project_production',
      status: 'succeeded',
      finishedAt: now,
      cleanupQueuedAt: now,
    })
    await db.insert(agentJobs).values({
      id: jobId,
      type: 'backup_cleanup',
      status: 'queued',
      serverId: f.serverId,
      projectId: f.projectId,
      payload: {
        schemaVersion: 1,
        backupRunIds: [runId],
        localObjectKeys: [],
        remoteObjectKeys: [],
      },
    })
    const changed =
      kind === 'project'
        ? await deleteProjectState(db, {
            projectId: f.projectId,
            teamId: f.teamId,
            userId: f.userId,
            removeDeployments: true,
            now,
          })
        : kind === 'team'
          ? await deleteTeamState(db, {
              teamId: f.teamId,
              userId: f.userId,
              now,
            })
          : await deleteServerState(db, {
              serverId: f.serverId,
              teamId: f.teamId,
              userId: f.userId,
              cancelOngoingDeployments: true,
              now,
            })
    expect(changed).toBe(true)
    expect(
      (await db.select().from(backupRuns).where(eq(backupRuns.id, runId)))[0]
        ?.cleanupQueuedAt,
    ).toBeNull()
    expect(
      (await db.select().from(agentJobs).where(eq(agentJobs.id, jobId)))[0]
        ?.status,
    ).toBe('canceled')
    touchedAgentJobIds.push(
      ...(
        await db
          .select({ id: agentJobs.id })
          .from(agentJobs)
          .where(eq(agentJobs.serverId, f.serverId))
      ).map((job) => job.id),
    )
  },
)

test.each(['server', 'project'] as const)(
  'retention never reserves backup cleanup work for a deleted %s',
  async (kind) => {
    const f = await createProjectEnvironment()
    const policy = await createBackupPolicyFixture({
      projectId: f.projectId,
      environmentId: f.environmentId,
      enabled: true,
      destination: { bucket: 'local-backups' },
      retention: {
        local: { count: 0, days: 1, maxStorageGb: 0 },
        remote: { enabled: false, count: 0, days: 0, maxStorageGb: 0 },
      },
    })
    touchedBackupConfigIds.push(policy.id)
    const runId = makeId('expired-run'),
      artifactId = makeId('expired-artifact')
    touchedBackupRunIds.push(runId)
    touchedArtifactIds.push(artifactId)
    await db.insert(backupRuns).values({
      id: runId,
      configId: policy.id,
      projectId: f.projectId,
      environmentId: f.environmentId,
      serverId: f.serverId,
      runtimeId: 'dp_project_production',
      status: 'succeeded',
      finishedAt: new Date('2020-01-01'),
    })
    await db.insert(backupArtifacts).values({
      id: artifactId,
      backupRunId: runId,
      type: 'volume',
      storage: 'local',
      objectKey: 'expired/volume.tar',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 12,
    })
    if (kind === 'server')
      await db
        .update(servers)
        .set({ status: 'deleted' })
        .where(eq(servers.id, f.serverId))
    else
      await db
        .update(projects)
        .set({ status: 'deleted' })
        .where(eq(projects.id, f.projectId))
    expect(
      await queueBackupRetentionCleanupJobs({ projectId: f.projectId }),
    ).toEqual([])
    expect(
      await enqueueBackupCleanup(db, {
        jobId: makeId('never-queued'),
        projectId: f.projectId,
        serverId: f.serverId,
        backupRunIds: [runId],
        now: new Date(),
        destination: { bucket: 'local-backups' },
        artifacts: [
          {
            backupRunId: runId,
            storage: 'local',
            objectKey: 'expired/volume.tar',
          },
        ],
      }),
    ).toEqual([])
    expect(
      (await db.select().from(backupRuns).where(eq(backupRuns.id, runId)))[0]
        ?.cleanupQueuedAt,
    ).toBeNull()
  },
)

async function createProjectEnvironment() {
  const userId = makeId('user')
  const teamId = makeId('team')
  const serverId = makeId('server')
  const projectId = makeId('project')
  const environmentId = makeId('environment')
  const token = makeId('agent-token')
  touchedUserIds.push(userId)
  touchedTeamIds.push(teamId)
  touchedServerIds.push(serverId)
  touchedProjectIds.push(projectId)
  touchedEnvironmentIds.push(environmentId)

  await db.insert(user).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: true,
    name: userId,
    username: makeUsername(userId),
  })
  await db.insert(teams).values({
    id: teamId,
    name: 'Backup team',
    slug: makeSlug(teamId),
  })
  await db.insert(teamMembers).values({
    id: makeId('member'),
    role: 'owner',
    teamId,
    userId,
  })
  await db.insert(servers).values({
    id: serverId,
    name: 'Backup server',
    handle: makeSlug(serverId),
    status: 'connected',
    teamId,
    agentCredentialHash: hashToken(token),
  })
  await db.insert(projects).values({
    id: projectId,
    githubRepo: 'example/backups',
    name: 'Backup project',
    slug: makeSlug(projectId),
    teamId,
  })
  await db.insert(environments).values({
    id: environmentId,
    branch: 'main',
    isProduction: true,
    name: 'Production',
    projectId,
    runtimeId: 'dp_project_production',
    serverId,
    slug: 'production',
  })

  return {
    environmentId,
    projectId,
    serverId,
    token,
    userId,
    teamId,
    teamSlug: makeSlug(teamId),
  }
}

async function cleanupRows() {
  if (touchedAgentJobIds.length > 0) {
    await db.delete(agentJobs).where(inArray(agentJobs.id, touchedAgentJobIds))
  }

  if (touchedArtifactIds.length > 0) {
    await db
      .delete(backupArtifacts)
      .where(inArray(backupArtifacts.id, touchedArtifactIds))
  }

  if (touchedBackupRunIds.length > 0) {
    await db
      .delete(backupRuns)
      .where(inArray(backupRuns.id, touchedBackupRunIds))
  }

  if (touchedBackupConfigIds.length > 0) {
    await db
      .delete(backupConfigs)
      .where(inArray(backupConfigs.id, touchedBackupConfigIds))
  }

  if (touchedEnvironmentIds.length > 0) {
    await db
      .delete(environments)
      .where(inArray(environments.id, touchedEnvironmentIds))
  }

  if (touchedProjectIds.length > 0) {
    await db.delete(projects).where(inArray(projects.id, touchedProjectIds))
  }

  if (touchedServerIds.length > 0) {
    await db.delete(servers).where(inArray(servers.id, touchedServerIds))
  }

  if (touchedTeamIds.length > 0) {
    await db
      .delete(teamMembers)
      .where(inArray(teamMembers.teamId, touchedTeamIds))
    await db.delete(teams).where(inArray(teams.id, touchedTeamIds))
  }

  if (touchedUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, touchedUserIds))
  }

  touchedAgentJobIds.length = 0
  touchedArtifactIds.length = 0
  touchedBackupRunIds.length = 0
  touchedBackupConfigIds.length = 0
  touchedEnvironmentIds.length = 0
  touchedProjectIds.length = 0
  touchedServerIds.length = 0
  touchedTeamIds.length = 0
  touchedUserIds.length = 0
}

function makeId(prefix: string) {
  return `it-${prefix}-${crypto.randomUUID()}`
}

function makeSlug(id: string) {
  return id.replaceAll('_', '-').slice(0, 50)
}

function makeUsername(id: string) {
  return id.replace(/[^A-Za-z0-9]/g, '').slice(0, 50)
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

// Fixture setup writes only fixture rows; production policy edits use the shared
// preparation and guarded policy state covered by project/API integration tests.
async function createBackupPolicyFixture(
  input: Partial<
    Omit<BackupPolicyInput, 'environmentId' | 'enabled' | 'destination'>
  > & {
    projectId: string
    environmentId: string
    enabled: boolean
    destination: BackupDestination | BackupStorageReference
  },
) {
  const project = (
    await db.select().from(projects).where(eq(projects.id, input.projectId))
  )[0]
  if (!project) throw new Error('Project fixture missing.')
  let destination: BackupStorageReference
  if ('bucket' in input.destination) {
    const storageId = crypto.randomUUID()
    await db.insert(backupStorage).values({
      id: storageId,
      teamId: project.teamId,
      name: 'Integration storage',
      bucket: input.destination.bucket,
      region: input.destination.region ?? 'auto',
      endpoint: input.destination.endpoint ?? null,
      accessKeyId: input.destination.accessKeyId ?? 'test-key',
      secretAccessKeyCiphertext:
        input.destination.secretAccessKeyCiphertext ??
        encryptSecret('test-secret'),
    })
    destination = {
      storageId,
      prefix: input.destination.prefix?.replace(/^\/+|\/+$/g, ''),
    }
  } else destination = input.destination
  const policy = backupConfigSchema.parse({
    name: 'Backup',
    schedule: { cron: '0 2 * * *' },
    retention: {
      local: { count: 7, days: 0, maxStorageGb: 0 },
      remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
    },
    volumes: { mode: 'allNamed', names: [] },
    databaseDumps: [],
    ...input,
    destination,
  })
  const [saved] = await db
    .insert(backupConfigs)
    .values({
      ...policy,
      id: crypto.randomUUID(),
      projectId: input.projectId,
      destinationType: 's3',
    })
    .returning()
  if (!saved) throw new Error('Policy fixture missing.')
  if (!destination.storageId) throw new Error('Storage fixture missing.')
  return {
    ...saved,
    destination: { ...policy.destination, storageId: destination.storageId },
  }
}

test('unavailable storage fails the claimed job and run without using a saved secret', async () => {
  const f = await createProjectEnvironment()
  const policy = await createBackupPolicyFixture({
    projectId: f.projectId,
    environmentId: f.environmentId,
    enabled: true,
    destination: { bucket: 'own-bucket' },
    retention: {
      local: { count: 7, days: 0, maxStorageGb: 0 },
      remote: { enabled: true, count: 7, days: 0, maxStorageGb: 0 },
    },
  })
  touchedBackupConfigIds.push(policy.id)
  const queued = (await queueEnvironmentBackup({
    projectId: f.projectId,
    environmentId: f.environmentId,
  }))!
  touchedBackupRunIds.push(queued.backupRunId)
  touchedAgentJobIds.push(queued.agentJobId)
  const [job] = await db
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.id, queued.agentJobId))
  const payload = job!.payload as BackupJobPayload
  await db
    .update(agentJobs)
    .set({
      payload: {
        ...payload,
        destination: {
          ...payload.destination,
          storageId: 'missing-storage',
          secretAccessKeyCiphertext: encryptSecret(
            'saved-secret-must-not-be-used',
          ),
        },
      },
    })
    .where(eq(agentJobs.id, queued.agentJobId))
  expect(
    await claimNextAgentJob({
      serverId: f.serverId,
      token: f.token,
      protocolVersion: 1,
      capabilities: ['jobs.backup.v1'],
    }),
  ).toBeNull()
  expect(
    (
      await db
        .select()
        .from(agentJobs)
        .where(eq(agentJobs.id, queued.agentJobId))
    )[0]?.status,
  ).toBe('failed')
  expect(
    (
      await db
        .select()
        .from(backupRuns)
        .where(eq(backupRuns.id, queued.backupRunId))
    )[0]?.status,
  ).toBe('failed')
})

test('one unsupported remote snapshot does not stop retention for valid snapshots', async () => {
  const f = await createProjectEnvironment()
  const policy = await createBackupPolicyFixture({
    projectId: f.projectId,
    environmentId: f.environmentId,
    enabled: true,
    destination: { bucket: 'retention-bucket' },
    retention: {
      local: { count: 0, days: 0, maxStorageGb: 0 },
      remote: { enabled: true, count: 0, days: 1, maxStorageGb: 0 },
    },
  })
  touchedBackupConfigIds.push(policy.id)
  const invalidId = makeId('unsupported-run'),
    validId = makeId('valid-run')
  for (const [id, destination, finishedAt] of [
    [invalidId, { bucket: 'retention-bucket' }, new Date('2020-02-01')],
    [
      validId,
      { bucket: 'retention-bucket', storageId: policy.destination.storageId },
      new Date('2020-01-01'),
    ],
  ] as const) {
    touchedBackupRunIds.push(id)
    await db.insert(backupRuns).values({
      id,
      projectId: f.projectId,
      environmentId: f.environmentId,
      serverId: f.serverId,
      runtimeId: 'dp_project_production',
      status: 'succeeded',
      destination,
      finishedAt,
    })
    const artifactId = makeId('retention-artifact')
    touchedArtifactIds.push(artifactId)
    await db.insert(backupArtifacts).values({
      id: artifactId,
      backupRunId: id,
      type: 'volume',
      storage: 'remote',
      objectKey: `${id}/volume.tar`,
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 10,
    })
  }
  const queued = await queueBackupRetentionCleanupJobs({
    projectId: f.projectId,
  })
  touchedAgentJobIds.push(...queued.map((job) => job.id))
  expect(queued).toEqual([{ id: expect.any(String), backupRunIds: [validId] }])
  expect(
    (await db.select().from(backupRuns).where(eq(backupRuns.id, invalidId)))[0]
      ?.cleanupQueuedAt,
  ).toBeNull()
})

test('failed credential claims do not create a cleanup job on every maintenance tick', async () => {
  const f = await createProjectEnvironment()
  const policy = await createBackupPolicyFixture({
    projectId: f.projectId,
    environmentId: f.environmentId,
    enabled: true,
    destination: { bucket: 'retention-bucket' },
    retention: {
      local: { count: 0, days: 0, maxStorageGb: 0 },
      remote: { enabled: true, count: 0, days: 1, maxStorageGb: 0 },
    },
  })
  touchedBackupConfigIds.push(policy.id)
  const runId = makeId('failing-cleanup'),
    artifactId = makeId('remote-archive')
  touchedBackupRunIds.push(runId)
  touchedArtifactIds.push(artifactId)
  await db.insert(backupRuns).values({
    id: runId,
    projectId: f.projectId,
    environmentId: f.environmentId,
    serverId: f.serverId,
    runtimeId: 'dp_project_production',
    status: 'succeeded',
    finishedAt: new Date('2020-01-01'),
    destination: {
      bucket: 'retention-bucket',
      storageId: policy.destination.storageId,
    },
  })
  await db.insert(backupArtifacts).values({
    id: artifactId,
    backupRunId: runId,
    type: 'volume',
    storage: 'remote',
    objectKey: 'retained/data.tar',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 10,
  })
  await db
    .update(backupStorage)
    .set({ secretAccessKeyCiphertext: 'invalid-ciphertext' })
    .where(eq(backupStorage.id, policy.destination.storageId))
  const queued = await queueBackupRetentionCleanupJobs({
    projectId: f.projectId,
  })
  touchedAgentJobIds.push(...queued.map((job) => job.id))
  expect(queued).toHaveLength(1)
  expect(
    await claimNextAgentJob({
      serverId: f.serverId,
      token: f.token,
      protocolVersion: 1,
      capabilities: ['jobs.backup.cleanup.v1'],
    }),
  ).toBeNull()
  const [failed] = await db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.id, runId))
  expect(failed?.cleanupQueuedAt).toBeNull()
  expect(failed?.cleanupErrorMessage).toBeTruthy()
  const now = new Date()
  expect(
    await queueBackupRetentionCleanupJobs({ projectId: f.projectId, now }),
  ).toEqual([])
  expect(
    await enqueueBackupCleanup(db, {
      jobId: makeId('early-retry'),
      projectId: f.projectId,
      serverId: f.serverId,
      backupRunIds: [runId],
      now,
      destination: {
        bucket: 'retention-bucket',
        storageId: policy.destination.storageId,
      },
      artifacts: [
        {
          backupRunId: runId,
          storage: 'remote',
          objectKey: 'retained/data.tar',
        },
      ],
    }),
  ).toEqual([])
  const retry = await queueBackupRetentionCleanupJobs({
    projectId: f.projectId,
    now: new Date(now.getTime() + 60 * 60 * 1000 + 1),
  })
  touchedAgentJobIds.push(...retry.map((job) => job.id))
  expect(retry).toHaveLength(1)
  expect(
    (await db.select().from(backupRuns).where(eq(backupRuns.id, runId)))[0]
      ?.cleanupErrorMessage,
  ).toBeNull()
})
