import { createHash } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import {
  agentJobs,
  backupArtifacts,
  backupConfigs,
  backupRuns,
  environments,
  projects,
  servers,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import { claimNextAgentJob } from '@/server/agents/jobs'
import { currentAgentCapabilities } from '@/server/agents/compatibility'
import {
  createBackupRun,
  listEnvironmentBackupRuns,
  listProjectBackupConfigs,
  recordBackupArtifacts,
  queueDueBackupSchedules,
  queueEnvironmentBackup,
  queueBackupRetentionCleanupJobs,
  queueBackupRestoreJob,
  upsertBackupConfig,
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
  test('upserts backup configuration for an environment', async () => {
    const { environmentId, projectId } = await createProjectEnvironment()

    const config = await upsertBackupConfig({
      projectId,
      environmentId,
      enabled: true,
      destination: {
        bucket: 'devpush-backups',
        prefix: '/team/project/env/',
        region: 'us-east-1',
      },
      databaseDumps: [
        {
          service: 'postgres',
          command: 'pg_dumpall -U "$POSTGRES_USER" | gzip',
        },
      ],
    })
    touchedBackupConfigIds.push(config.id)

    expect(config).toMatchObject({
      projectId,
      environmentId,
      enabled: true,
      destination: {
        bucket: 'devpush-backups',
        prefix: 'team/project/env',
        region: 'us-east-1',
      },
      retention: {
        local: {
          count: 7,
          days: 0,
          maxStorageGb: 0,
        },
        remote: {
          enabled: false,
          count: 7,
          days: 0,
          maxStorageGb: 0,
        },
      },
      databaseDumps: [
        {
          service: 'postgres',
          command: 'pg_dumpall -U "$POSTGRES_USER" | gzip',
        },
      ],
    })

    const updated = await upsertBackupConfig({
      projectId,
      environmentId,
      enabled: false,
      destination: {
        bucket: 'devpush-backups',
        prefix: 'updated',
      },
      retention: {
        local: {
          count: 3,
          days: 0,
          maxStorageGb: 0,
        },
        remote: {
          enabled: true,
          count: 3,
          days: 0,
          maxStorageGb: 0,
        },
      },
    })

    const configs = await listProjectBackupConfigs(projectId)

    expect(updated.id).toBe(config.id)
    expect(configs).toHaveLength(1)
    expect(configs[0]).toMatchObject({
      id: config.id,
      enabled: false,
      destination: {
        bucket: 'devpush-backups',
        prefix: 'updated',
      },
      retention: {
        local: {
          count: 3,
          days: 0,
          maxStorageGb: 0,
        },
        remote: {
          enabled: true,
          count: 3,
          days: 0,
          maxStorageGb: 0,
        },
      },
      databaseDumps: [],
    })
  })

  test('rejects backup config for an environment outside the project', async () => {
    const first = await createProjectEnvironment()
    const second = await createProjectEnvironment()

    await expect(
      upsertBackupConfig({
        projectId: first.projectId,
        environmentId: second.environmentId,
        enabled: true,
        destination: {
          bucket: 'devpush-backups',
        },
      }),
    ).rejects.toThrow('Backup environment not found.')
  })

  test('records backup runs and artifacts', async () => {
    const { environmentId, projectId, serverId } =
      await createProjectEnvironment()

    const run = await createBackupRun({
      projectId,
      environmentId,
      serverId,
      runtimeId: 'dp_project_production',
      manifest: {
        schemaVersion: 1,
        commit: 'abc123',
      },
    })
    touchedBackupRunIds.push(run.id)

    const artifacts = await recordBackupArtifacts({
      backupRunId: run.id,
      artifacts: [
        {
          type: 'manifest',
          storage: 'remote',
          objectKey: 'manifest.json',
          checksumSha256:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          sizeBytes: 512,
        },
        {
          type: 'volume',
          storage: 'local',
          objectKey: 'volumes/postgres-data.tar.zst',
          checksumSha256:
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          sizeBytes: 1024,
        },
      ],
    })
    touchedArtifactIds.push(...artifacts.map((artifact) => artifact.id))

    const runs = await listEnvironmentBackupRuns(environmentId)

    expect(run).toMatchObject({
      projectId,
      environmentId,
      serverId,
      runtimeId: 'dp_project_production',
      status: 'queued',
    })
    expect(artifacts).toHaveLength(2)
    expect(runs.map((item) => item.id)).toEqual([run.id])
  })

  test('queues and claims backup agent jobs', async () => {
    const { environmentId, projectId, serverId, token } =
      await createProjectEnvironment()

    const config = await upsertBackupConfig({
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
          command: 'pg_dumpall -U "$POSTGRES_USER" | gzip',
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
        localBasePath: `/var/lib/devpush/backups/${projectId}/${environmentId}/${queued.backupRunId}`,
        projectId,
        environmentId,
        runtimeId: 'dp_project_production',
        destination: {
          bucket: 'devpush-backups',
          prefix: 'backups',
        },
        databaseDumps: [
          {
            service: 'postgres',
            command: 'pg_dumpall -U "$POSTGRES_USER" | gzip',
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
        localBasePath: `/var/lib/devpush/backups/${projectId}/${environmentId}/${queued.backupRunId}`,
      },
    })
  })

  test('queues retention cleanup jobs once for expired backups', async () => {
    const { environmentId, projectId, serverId } =
      await createProjectEnvironment()
    const config = await upsertBackupConfig({
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
        finishedAt: new Date('2026-06-20T12:00:00.000Z'),
      },
      {
        id: expiredRunId,
        projectId,
        environmentId,
        serverId,
        runtimeId: 'dp_project_production',
        status: 'succeeded',
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

  test('queues restore jobs for selected backup artifacts', async () => {
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
      status: 'succeeded',
      finishedAt: new Date('2026-06-20T12:00:00.000Z'),
    })
    await db.insert(backupArtifacts).values({
      id: artifactId,
      backupRunId,
      type: 'volume',
      storage: 'local',
      objectKey: '/var/lib/devpush/backups/run/volumes/postgres-data.tar.gz',
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
                '/var/lib/devpush/backups/run/volumes/postgres-data.tar.gz',
              checksumSha256:
                'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              targetVolume: 'postgres-data',
            },
          ],
        },
      },
    ])
  })

  test('queues local retention cleanup when remote backups are disabled', async () => {
    const { environmentId, projectId, serverId } =
      await createProjectEnvironment()
    const config = await upsertBackupConfig({
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
    ]
    touchedBackupRunIds.push(...backupRunIds)
    await db.insert(backupRuns).values([
      {
        id: backupRunIds[0],
        projectId,
        environmentId,
        serverId,
        runtimeId: 'dp_project_production',
        status: 'succeeded',
        finishedAt: new Date('2026-06-20T12:00:00.000Z'),
      },
      {
        id: backupRunIds[1],
        projectId,
        environmentId,
        serverId,
        runtimeId: 'dp_project_production',
        status: 'succeeded',
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
      objectKey: '/var/lib/devpush/backups/expired/manifest.json',
      checksumSha256:
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
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
  })

  test('queues due backup schedules', async () => {
    const { environmentId, projectId } = await createProjectEnvironment()
    const config = await upsertBackupConfig({
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
  })

  test('does not queue backups for deleted servers', async () => {
    const { environmentId, projectId, serverId } =
      await createProjectEnvironment()
    const config = await upsertBackupConfig({
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
