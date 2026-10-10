import { required } from '@/test/required'
import * as realtime from '@/server/realtime/service'
import { createHash } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'
import { claimDeployment } from './claims'

import { closeDb, db, logsDb } from '@/server/db'
import { deploymentLogs } from '@/server/db/log-schema'
import {
  deploymentEvents,
  agentJobs,
  backupArtifacts,
  backupRuns,
  deployments,
  environments,
  githubInstallations,
  aliases,
  projects,
  servers,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import { insertDeploymentEvents } from '@/server/logs/events'
import { appendDeploymentLogs } from '@/server/logs/deployments'
import { pruneOrphanDeploymentLogs } from '@/server/logs/cleanup'
import {
  readProjectDeploymentLogs,
  projectHasDeploymentLogs,
} from '@/server/projects/deployment-logs'
import {
  getProjectLogsSectionContext,
  getDeploymentLogsContext,
} from '@/server/projects/context'
import { currentAgentCapabilities } from './compatibility'
import {
  claimNextAgentJob,
  failStaleRunningDeployments,
  completeBackupCleanupJob,
  completeBackupJob,
  completeDeploymentJob,
  completeRestoreJob,
  recordDeploymentProgress,
} from './jobs'
import { encryptDeploymentEnvVars } from '@/server/projects/deployment-config'

const touchedArtifactIds: Array<string> = []
const touchedAgentJobIds: Array<string> = []
const touchedBackupRunIds: Array<string> = []
const touchedDeploymentIds: Array<string> = []
const touchedEnvironmentIds: Array<string> = []
const touchedHostnameIds: Array<string> = []
const touchedInstallationIds: Array<number> = []
const touchedProjectIds: Array<string> = []
const touchedServerIds: Array<string> = []
const touchedTeamIds: Array<string> = []
const touchedUserIds: Array<string> = []

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('agent deployment jobs', () => {
  test('publishes timeout updates only when a deployment changes', async () => {
    const { deploymentId, serverId } = await createFixture()
    const notification = vi.spyOn(realtime, 'notifyServer').mockResolvedValue()
    await db
      .update(deployments)
      .set({
        status: 'running',
        startedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      })
      .where(eq(deployments.id, deploymentId))
    await failStaleRunningDeployments(serverId)
    expect(notification).toHaveBeenCalledExactlyOnceWith(
      serverId,
      'deployments',
    )
    await failStaleRunningDeployments(serverId)
    expect(notification).toHaveBeenCalledTimes(1)
  })
  test('publishes a terminal update when preparing a claimed job fails', async () => {
    const { deploymentId, serverId, token } = await createFixture()
    const notification = vi.spyOn(realtime, 'notifyServer').mockResolvedValue()
    await db
      .update(deployments)
      .set({
        status: 'queued',
        phase: 'queued',
        envVars: encryptDeploymentEnvVars([]),
      })
      .where(eq(deployments.id, deploymentId))
    await expect(
      claimNextAgentJob({
        serverId,
        token,
        protocolVersion: 1,
        capabilities: [...currentAgentCapabilities],
      }),
    ).resolves.toBeNull()
    const [deployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
    expect(deployment?.status).toBe('failed')
    expect(notification).toHaveBeenCalledWith(serverId, 'deployments')
  })
  test('concurrent SQLite claims run unrelated runtimes while keeping one deployment per shared runtime', async () => {
    const { deploymentId, serverId } = await createFixture()
    const [original] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
    await db
      .update(deployments)
      .set({ status: 'queued' })
      .where(eq(deployments.id, deploymentId))
    const secondId = `${deploymentId}-second`
    const independentId = `${deploymentId}-independent`
    touchedDeploymentIds.push(secondId, independentId)
    await db.insert(deployments).values([
      {
        ...required(original),
        id: secondId,
        status: 'queued',
        createdAt: new Date(required(original).createdAt.getTime() + 1),
      },
      {
        ...required(original),
        id: independentId,
        status: 'queued',
        runtimeId: `${required(original).runtimeId}-other`,
        createdAt: new Date(required(original).createdAt.getTime() + 2),
      },
    ])
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        claimDeployment(db, serverId, new Date()),
      ),
    )
    expect(results.flatMap((row) => (row ? [row.id] : [])).sort()).toEqual(
      [deploymentId, independentId].sort(),
    )
    expect(await claimDeployment(db, serverId, new Date())).toBeNull()
    await db
      .update(deployments)
      .set({ status: 'succeeded' })
      .where(eq(deployments.id, deploymentId))
    expect((await claimDeployment(db, serverId, new Date()))?.id).toBe(secondId)
  })

  test('rolls back control events with their main state changes', async () => {
    const { deploymentId } = await createFixture()
    await expect(
      db.batch([
        db
          .update(deployments)
          .set({ status: 'canceled' })
          .where(eq(deployments.id, deploymentId)),
        insertDeploymentEvents(db, {
          deploymentId,
          stream: 'control',
          seq: 1,
          content: 'Canceled',
        }),
        insertDeploymentEvents(db, {
          deploymentId,
          stream: 'control',
          seq: 1,
          content: 'Duplicate forces rollback',
        }),
      ]),
    ).rejects.toThrow()
    expect(
      await db
        .select()
        .from(deploymentEvents)
        .where(eq(deploymentEvents.deploymentId, deploymentId)),
    ).toEqual([])
    expect(
      required(
        (
          await db
            .select()
            .from(deployments)
            .where(eq(deployments.id, deploymentId))
        )[0],
      ).status,
    ).toBe('running')
  })

  test('skips removed deployments while reading and prunes their output in bounded resumable batches', async () => {
    const { deploymentId, projectId, environmentId, serverId, token } =
      await createFixture()
    await recordDeploymentProgress({
      serverId,
      token,
      progress: {
        deploymentId,
        logStartSeq: 1,
        logs: ['live output'],
        events: [],
      },
    })
    const orphanId = `orphan-${crypto.randomUUID()}`
    await appendDeploymentLogs(
      {
        projectId,
        environmentId,
        serverId,
        deploymentId: orphanId,
        branch: 'main',
      },
      1,
      Array.from({ length: 1005 }, (_, index) => `orphan output ${index}`),
    )
    expect(
      (await readProjectDeploymentLogs({ projectId })).map(
        (row) => row.content,
      ),
    ).toEqual(['live output'])
    expect((await pruneOrphanDeploymentLogs()).deleted).toBe(1000)
    expect((await pruneOrphanDeploymentLogs()).deleted).toBe(5)
    expect(
      await logsDb
        .select()
        .from(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, orphanId)),
    ).toEqual([])
    expect(
      await logsDb
        .select()
        .from(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, deploymentId)),
    ).toHaveLength(1)
  })

  test('keeps stored output when completion state fails, then safely retries', async () => {
    const { deploymentId, serverId, token } = await createFixture()
    const completion = {
      deploymentId,
      status: 'succeeded' as const,
      gitSha: null,
      logStartSeq: 1,
      logs: ['ÄPI built'],
      events: [],
    }
    const failure = vi
      .spyOn(db, 'batch')
      .mockRejectedValueOnce(new Error('main unavailable'))
    await expect(
      completeDeploymentJob({ serverId, token, completion }),
    ).rejects.toThrow('main unavailable')
    failure.mockRestore()
    expect(
      required(
        (
          await db
            .select()
            .from(deployments)
            .where(eq(deployments.id, deploymentId))
        )[0],
      ).status,
    ).toBe('running')
    expect(
      await logsDb
        .select()
        .from(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, deploymentId)),
    ).toHaveLength(1)
    expect(
      await completeDeploymentJob({ serverId, token, completion }),
    ).toEqual({ ok: true })
    expect(
      await logsDb
        .select()
        .from(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, deploymentId)),
    ).toHaveLength(1)
  })

  test('preserves the queued full commit SHA when an agent reports an abbreviation', async () => {
    const { deploymentId, serverId, token } = await createFixture()
    const sha = 'abcdef0123456789abcdef0123456789abcdef0123'
    await db
      .update(deployments)
      .set({ gitSha: sha })
      .where(eq(deployments.id, deploymentId))
    await completeDeploymentJob({
      serverId,
      token,
      completion: {
        deploymentId,
        status: 'succeeded',
        gitSha: sha.slice(0, 7),
        logStartSeq: 1,
        logs: [],
        events: [],
      },
    })
    expect(
      required(
        (
          await db
            .select()
            .from(deployments)
            .where(eq(deployments.id, deploymentId))
        )[0],
      ).gitSha,
    ).toBe(sha)
  })

  test('does not finalize after partial output storage and deduplicates completed batches on retry', async () => {
    const { deploymentId, serverId, token } = await createFixture()
    const completion = {
      deploymentId,
      status: 'succeeded' as const,
      gitSha: null,
      logStartSeq: 1,
      logs: Array.from({ length: 40 }, (_, index) => `line ${index}`),
      events: [],
    }
    const batch = logsDb.batch.bind(logsDb)
    let calls = 0
    const failure = vi.spyOn(logsDb, 'batch').mockImplementation((queries) => {
      if (++calls === 2) throw new Error('log store unavailable')
      return batch(queries)
    })
    await expect(
      completeDeploymentJob({ serverId, token, completion }),
    ).rejects.toThrow('log store unavailable')
    failure.mockRestore()
    expect(
      await logsDb
        .select()
        .from(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, deploymentId)),
    ).toHaveLength(32)
    expect(
      required(
        (
          await db
            .select()
            .from(deployments)
            .where(eq(deployments.id, deploymentId))
        )[0],
      ).status,
    ).toBe('running')
    await completeDeploymentJob({ serverId, token, completion })
    expect(
      await logsDb
        .select()
        .from(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, deploymentId)),
    ).toHaveLength(40)
  })

  test('accepts late completion output while keeping canceled state and aliases unchanged', async () => {
    const { deploymentId, hostnameId, serverId, token } = await createFixture()
    await db
      .update(deployments)
      .set({ status: 'canceled', phase: 'canceled' })
      .where(eq(deployments.id, deploymentId))
    expect(
      await completeDeploymentJob({
        serverId,
        token,
        completion: {
          deploymentId,
          status: 'succeeded',
          gitSha: 'late',
          logStartSeq: 1,
          logs: ['final captured output'],
          events: [],
        },
      }),
    ).toEqual({ ok: true, ignored: true })
    expect(
      (
        await db
          .select()
          .from(deployments)
          .where(eq(deployments.id, deploymentId))
      )[0],
    ).toMatchObject({
      status: 'canceled',
      phase: 'canceled',
      gitSha: 'abc1234',
    })
    expect(
      required(
        (await db.select().from(aliases).where(eq(aliases.id, hostnameId)))[0],
      ).deploymentId,
    ).toBeNull()
    expect(
      await logsDb
        .select()
        .from(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, deploymentId)),
    ).toHaveLength(1)
    expect(
      await recordDeploymentProgress({
        serverId,
        token,
        progress: {
          deploymentId,
          logStartSeq: 2,
          logs: ['late progress'],
          events: [{ phase: 'revision_started', message: 'late' }],
        },
      }),
    ).toEqual({ ok: true, ignored: true })
    expect(
      required(
        (
          await db
            .select()
            .from(deployments)
            .where(eq(deployments.id, deploymentId))
        )[0],
      ).phase,
    ).toBe('canceled')
  })

  test('merges atomic control events with output, preserves filters and rejects unauthorized reads', async () => {
    const {
      deploymentId,
      projectId,
      environmentId,
      serverId,
      token,
      userId,
      teamSlug,
      projectName,
    } = await createFixture()
    await insertDeploymentEvents(db, {
      deploymentId,
      stream: 'control',
      seq: 1,
      content: 'Queued ÄPI',
    })
    await recordDeploymentProgress({
      serverId,
      token,
      progress: {
        deploymentId,
        logStartSeq: 1,
        logs: ['ÄPI output'],
        events: [],
      },
    })
    const rows = await readProjectDeploymentLogs({ projectId, keyword: 'äpi' })
    expect(rows.map((row) => row.stream).sort()).toEqual(['control', 'deploy'])
    expect(
      await getDeploymentLogsContext({
        deploymentId,
        userId,
        teamSlug,
        projectName,
      }),
    ).toHaveLength(2)
    await expect(
      getDeploymentLogsContext({
        deploymentId,
        userId: 'outsider',
        teamSlug,
        projectName,
      }),
    ).rejects.toThrow('Deployment not found')
    const context = { userId, teamSlug, projectName }
    expect(
      await getProjectLogsSectionContext({ ...context, branch: 'other' }),
    ).toMatchObject({ logs: [], hasAnyLogs: true })
    expect(
      (
        await getProjectLogsSectionContext({
          ...context,
          environmentId,
          deploymentId,
          keyword: 'äpi',
        })
      ).logs,
    ).toHaveLength(2)
    expect(await projectHasDeploymentLogs(projectId)).toBe(true)
    await db.delete(deployments).where(eq(deployments.id, deploymentId))
    expect(await readProjectDeploymentLogs({ projectId })).toEqual([])
    expect(await projectHasDeploymentLogs(projectId)).toBe(false)
  })

  test('allows a deleted server to claim deployments intentionally left running', async () => {
    const { deploymentId, projectId, serverId, token } = await createFixture()
    const installationId = Math.floor(Math.random() * 1_000_000_000) + 1
    touchedInstallationIds.push(installationId)
    await db.insert(githubInstallations).values({
      installationId,
      accountLogin: 'acme',
      accountType: 'Organization',
      repositorySelection: 'selected',
    })
    await Promise.all([
      db
        .update(deployments)
        .set({
          status: 'queued',
          phase: 'queued',
          envVars: encryptDeploymentEnvVars([]),
        })
        .where(eq(deployments.id, deploymentId)),
      db
        .update(projects)
        .set({ githubInstallationId: installationId, githubRepoId: 1 })
        .where(eq(projects.id, projectId)),
      db
        .update(servers)
        .set({ status: 'deleted' })
        .where(eq(servers.id, serverId)),
    ])

    await expect(
      claimNextAgentJob({
        serverId,
        token,
        protocolVersion: 1,
        capabilities: [...currentAgentCapabilities],
        createAccessToken: async () => ({
          token: 'installation-token',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
    ).resolves.toMatchObject({ type: 'deploy', id: deploymentId })
  })

  test('records agent-side cancellation as canceled, not failed', async () => {
    const { deploymentId, serverId, token } = await createFixture()

    await completeDeploymentJob({
      serverId,
      token,
      completion: {
        deploymentId,
        status: 'canceled',
        gitSha: null,
        logStartSeq: 2,
        logs: ['Deployment canceled because a newer deployment was queued.'],
        events: [
          {
            phase: 'completed',
            message:
              'Deployment canceled because a newer deployment was queued.',
          },
        ],
      },
    })

    const rows = await db
      .select({
        status: deployments.status,
        phase: deployments.phase,
        errorMessage: deployments.errorMessage,
      })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))

    expect(rows.at(0)).toEqual({
      status: 'canceled',
      phase: 'canceled',
      errorMessage:
        'Deployment canceled because a newer deployment was queued.',
    })
  })

  test('ignores a repeated deployment completion', async () => {
    const { deploymentId, serverId, token } = await createFixture()
    const completion = {
      deploymentId,
      status: 'succeeded' as const,
      gitSha: null,
      logStartSeq: 1,
      logs: ['Deployment succeeded.'],
      events: [
        {
          phase: 'completed' as const,
          message: 'Deployment succeeded.',
        },
      ],
    }

    await expect(
      completeDeploymentJob({ serverId, token, completion }),
    ).resolves.toEqual({ ok: true })
    await expect(
      completeDeploymentJob({ serverId, token, completion }),
    ).resolves.toEqual({ ok: true, ignored: true })

    const rows = await logsDb
      .select({ content: deploymentLogs.content })
      .from(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, deploymentId))

    expect(
      rows.filter((row) => row.content === 'Deployment succeeded.'),
    ).toHaveLength(1)
  })

  test('points the environment alias at the completed deployment by environment id', async () => {
    const { deploymentId, hostnameId, serverId, token } = await createFixture()

    await completeDeploymentJob({
      serverId,
      token,
      completion: {
        deploymentId,
        status: 'succeeded',
        gitSha: null,
        logStartSeq: 1,
        logs: ['Deployment succeeded.'],
        events: [
          {
            phase: 'completed',
            message: 'Deployment succeeded.',
          },
        ],
      },
    })

    const rows = await db
      .select({
        deploymentId: aliases.deploymentId,
      })
      .from(aliases)
      .where(eq(aliases.id, hostnameId))

    expect(rows).toEqual([{ deploymentId }])
  })

  test('moves only the completed branch alias with the environment alias', async () => {
    const { deploymentId, environmentId, projectId, serverId, token } =
      await createFixture()
    const currentBranchAliasId = `hostname-${crypto.randomUUID()}`
    const otherBranchAliasId = `hostname-${crypto.randomUUID()}`
    touchedHostnameIds.push(currentBranchAliasId, otherBranchAliasId)

    await db.insert(aliases).values([
      {
        id: currentBranchAliasId,
        hostname: `${currentBranchAliasId}.devpush.local`,
        projectId,
        environmentId,
        type: 'branch',
        branch: 'main',
      },
      {
        id: otherBranchAliasId,
        hostname: `${otherBranchAliasId}.devpush.local`,
        projectId,
        environmentId,
        type: 'branch',
        branch: 'preview',
      },
    ])

    await completeDeploymentJob({
      serverId,
      token,
      completion: {
        deploymentId,
        status: 'succeeded',
        gitSha: null,
        logStartSeq: 1,
        logs: ['Deployment succeeded.'],
        events: [{ phase: 'completed', message: 'Deployment succeeded.' }],
      },
    })

    const rows = await db
      .select({
        branch: aliases.branch,
        deploymentId: aliases.deploymentId,
        type: aliases.type,
      })
      .from(aliases)
      .where(inArray(aliases.id, [currentBranchAliasId, otherBranchAliasId]))

    expect(rows).toEqual(
      expect.arrayContaining([
        { branch: 'main', deploymentId, type: 'branch' },
        { branch: 'preview', deploymentId: null, type: 'branch' },
      ]),
    )
  })

  test('failed remote uploads retain local artifacts without becoming successful backups', async () => {
    const { backupRunId, jobId, serverId, token } = await createBackupFixture()
    await completeBackupJob({
      serverId,
      token,
      completion: {
        jobId,
        backupRunId,
        status: 'failed',
        message: 'Remote upload failed.',
        manifest: { localRecoveryAvailable: true },
        artifacts: [
          {
            type: 'volume',
            storage: 'local',
            objectKey:
              '/var/lib/devpush-agent/backups/project/environment/run/volumes/data.tar.gz',
            checksumSha256: 'a'.repeat(64),
            sizeBytes: 12,
          },
        ],
      },
    })
    const rows = await db
      .select()
      .from(backupArtifacts)
      .where(eq(backupArtifacts.backupRunId, backupRunId))
    touchedArtifactIds.push(...rows.map((row) => row.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.storage).toBe('local')
    const [run] = await db
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.id, backupRunId))
    expect(run?.status).toBe('failed')
  })

  test('records completed backup jobs and artifacts', async () => {
    const { backupRunId, jobId, serverId, token } = await createBackupFixture()

    await completeBackupJob({
      serverId,
      token,
      completion: {
        jobId,
        backupRunId,
        status: 'succeeded',
        manifest: {
          schemaVersion: 1,
          runtimeId: 'dp_backup_runtime',
        },
        artifacts: [
          {
            type: 'manifest',
            storage: 'remote',
            objectKey:
              'projects/project/environments/environment/backups/runs/run/manifest.json',
            checksumSha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            sizeBytes: 512,
          },
        ],
      },
    })

    const [runRows, jobRows, artifactRows] = await Promise.all([
      db
        .select({
          status: backupRuns.status,
          manifest: backupRuns.manifest,
          errorMessage: backupRuns.errorMessage,
        })
        .from(backupRuns)
        .where(eq(backupRuns.id, backupRunId)),
      db
        .select({
          status: agentJobs.status,
          errorMessage: agentJobs.errorMessage,
        })
        .from(agentJobs)
        .where(eq(agentJobs.id, jobId)),
      db
        .select({
          id: backupArtifacts.id,
          type: backupArtifacts.type,
          objectKey: backupArtifacts.objectKey,
        })
        .from(backupArtifacts)
        .where(eq(backupArtifacts.backupRunId, backupRunId)),
    ])
    touchedArtifactIds.push(...artifactRows.map((row) => row.id))

    expect(runRows).toEqual([
      {
        status: 'succeeded',
        manifest: {
          schemaVersion: 1,
          runtimeId: 'dp_backup_runtime',
          databaseTargets: [],
        },
        errorMessage: null,
      },
    ])
    expect(jobRows).toEqual([{ status: 'succeeded', errorMessage: null }])
    expect(artifactRows).toMatchObject([
      {
        type: 'manifest',
        objectKey:
          'projects/project/environments/environment/backups/runs/run/manifest.json',
      },
    ])
  })

  test('rejects backup artifacts outside the claimed location', async () => {
    const { backupRunId, jobId, serverId, token } = await createBackupFixture()

    await expect(
      completeBackupJob({
        serverId,
        token,
        completion: {
          jobId,
          backupRunId,
          status: 'succeeded',
          artifacts: [
            {
              type: 'manifest',
              storage: 'local',
              objectKey: '/var/lib/devpush-agent/backups/other/manifest.json',
              checksumSha256: 'a'.repeat(64),
              sizeBytes: 512,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Backup artifact is outside the claimed backup location.',
    })
  })

  test('ignores a repeated backup completion without duplicating artifacts', async () => {
    const { backupRunId, jobId, serverId, token } = await createBackupFixture()
    const completion = {
      jobId,
      backupRunId,
      status: 'succeeded' as const,
      manifest: { schemaVersion: 1, runtimeId: 'dp_backup_runtime' },
      artifacts: [
        {
          type: 'manifest' as const,
          storage: 'remote' as const,
          objectKey:
            'projects/project/environments/environment/backups/runs/run/manifest.json',
          checksumSha256: 'a'.repeat(64),
          sizeBytes: 512,
        },
      ],
    }

    await expect(
      completeBackupJob({ serverId, token, completion }),
    ).resolves.toEqual({ ok: true })
    await expect(
      completeBackupJob({ serverId, token, completion }),
    ).resolves.toEqual({ ok: true, ignored: true })

    const rows = await db
      .select({ id: backupArtifacts.id })
      .from(backupArtifacts)
      .where(eq(backupArtifacts.backupRunId, backupRunId))
    touchedArtifactIds.push(...rows.map((row) => row.id))
    expect(rows).toHaveLength(1)
  })

  test('records completed backup cleanup jobs', async () => {
    const { backupRunId, jobId, serverId, token } =
      await createBackupCleanupFixture()

    await completeBackupCleanupJob({
      serverId,
      token,
      completion: {
        jobId,
        backupRunIds: [backupRunId],
        status: 'succeeded',
      },
    })

    const [runRows, jobRows, artifactRows] = await Promise.all([
      db
        .select({
          cleanupQueuedAt: backupRuns.cleanupQueuedAt,
          cleanupFinishedAt: backupRuns.cleanupFinishedAt,
          cleanupErrorMessage: backupRuns.cleanupErrorMessage,
        })
        .from(backupRuns)
        .where(eq(backupRuns.id, backupRunId)),
      db
        .select({
          status: agentJobs.status,
          errorMessage: agentJobs.errorMessage,
        })
        .from(agentJobs)
        .where(eq(agentJobs.id, jobId)),
      db
        .select({ id: backupArtifacts.id })
        .from(backupArtifacts)
        .where(eq(backupArtifacts.backupRunId, backupRunId)),
    ])

    expect(runRows.at(0)?.cleanupQueuedAt).toBeNull()
    expect(runRows.at(0)?.cleanupFinishedAt).toBeInstanceOf(Date)
    expect(runRows.at(0)?.cleanupErrorMessage).toBeNull()
    expect(jobRows).toEqual([{ status: 'succeeded', errorMessage: null }])
    expect(artifactRows).toEqual([])
  })

  test('records completed restore jobs', async () => {
    const { jobId, serverId, token } = await createRestoreFixture()

    await completeRestoreJob({
      serverId,
      token,
      completion: {
        jobId,
        status: 'succeeded',
      },
    })

    const jobRows = await db
      .select({
        status: agentJobs.status,
        errorMessage: agentJobs.errorMessage,
      })
      .from(agentJobs)
      .where(eq(agentJobs.id, jobId))

    expect(jobRows).toEqual([{ status: 'succeeded', errorMessage: null }])
  })
})

async function createBackupFixture() {
  const fixture = await createFixture()
  const backupRunId = `backup-run-${crypto.randomUUID()}`
  const jobId = `backup-job-${crypto.randomUUID()}`
  touchedBackupRunIds.push(backupRunId)
  touchedAgentJobIds.push(jobId)

  await db.insert(backupRuns).values({
    id: backupRunId,
    projectId: fixture.projectId,
    environmentId: fixture.environmentId,
    serverId: fixture.serverId,
    runtimeId: 'dp_backup_runtime',
    status: 'running',
    startedAt: new Date(),
  })
  await db.insert(agentJobs).values({
    id: jobId,
    type: 'backup',
    status: 'running',
    serverId: fixture.serverId,
    projectId: fixture.projectId,
    payload: {
      schemaVersion: 1,
      backupRunId,
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      runtimeId: 'dp_backup_runtime',
      destination: {
        bucket: 'devpush-backups',
      },
      artifactPrefix:
        'projects/project/environments/environment/backups/runs/run',
      localBasePath: '/var/lib/devpush-agent/backups/project/environment/run',
      retention: {
        local: {
          count: 7,
          days: 0,
          maxStorageGb: 0,
        },
        remote: {
          enabled: true,
          count: 7,
          days: 0,
          maxStorageGb: 0,
        },
      },
      volumes: {
        mode: 'none',
        names: [],
      },
      databaseDumps: [],
    },
    claimedAt: new Date(),
  })

  return {
    backupRunId,
    jobId,
    serverId: fixture.serverId,
    token: fixture.token,
  }
}

async function createBackupCleanupFixture() {
  const fixture = await createFixture()
  const backupRunId = `backup-run-${crypto.randomUUID()}`
  const jobId = `backup-cleanup-job-${crypto.randomUUID()}`
  const artifactId = `backup-artifact-${crypto.randomUUID()}`
  const now = new Date()
  touchedBackupRunIds.push(backupRunId)
  touchedAgentJobIds.push(jobId)
  touchedArtifactIds.push(artifactId)

  await db.insert(backupRuns).values({
    id: backupRunId,
    projectId: fixture.projectId,
    environmentId: fixture.environmentId,
    serverId: fixture.serverId,
    runtimeId: 'dp_backup_runtime',
    status: 'succeeded',
    startedAt: now,
    finishedAt: now,
    cleanupQueuedAt: now,
  })
  await db.insert(agentJobs).values({
    id: jobId,
    type: 'backup_cleanup',
    status: 'running',
    serverId: fixture.serverId,
    projectId: fixture.projectId,
    payload: {
      schemaVersion: 1,
      backupRunIds: [backupRunId],
      destination: {
        bucket: 'devpush-backups',
      },
      localObjectKeys: [],
      remoteObjectKeys: ['expired/manifest.json'],
      reason: 'retention',
    },
    claimedAt: now,
  })
  await db.insert(backupArtifacts).values({
    id: artifactId,
    backupRunId,
    type: 'manifest',
    storage: 'remote',
    objectKey: 'expired/manifest.json',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 1,
  })

  return {
    backupRunId,
    jobId,
    serverId: fixture.serverId,
    token: fixture.token,
  }
}

async function createRestoreFixture() {
  const fixture = await createFixture()
  const jobId = `restore-job-${crypto.randomUUID()}`
  const now = new Date()
  touchedAgentJobIds.push(jobId)

  await db.insert(agentJobs).values({
    id: jobId,
    type: 'restore',
    status: 'running',
    serverId: fixture.serverId,
    projectId: fixture.projectId,
    payload: {
      schemaVersion: 1,
      backupRunId: `backup-run-${crypto.randomUUID()}`,
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      runtimeId: 'dp_backup_runtime',
      artifacts: [
        {
          id: `artifact-${crypto.randomUUID()}`,
          type: 'volume',
          storage: 'local',
          objectKey: '/var/lib/devpush-agent/backups/run/volumes/data.tar.gz',
          checksumSha256:
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          targetVolume: 'data',
        },
      ],
    },
    claimedAt: now,
  })

  return {
    jobId,
    serverId: fixture.serverId,
    token: fixture.token,
  }
}

async function createFixture() {
  const suffix = crypto.randomUUID()
  const token = `token-${suffix}`
  const userId = `user-${suffix}`
  const teamId = `team-${suffix}`
  const serverId = `server-${suffix}`
  const projectId = `project-${suffix}`
  const environmentId = `environment-${suffix}`
  const deploymentId = `deployment-${suffix}`
  const hostnameId = `hostname-${suffix}`

  touchedUserIds.push(userId)
  touchedTeamIds.push(teamId)
  touchedServerIds.push(serverId)
  touchedProjectIds.push(projectId)
  touchedEnvironmentIds.push(environmentId)
  touchedDeploymentIds.push(deploymentId)
  touchedHostnameIds.push(hostnameId)

  await db.insert(user).values({
    id: userId,
    name: 'Agent Jobs User',
    username: `agent-jobs-${suffix.slice(0, 12)}`,
    email: `agent-jobs-${suffix}@example.com`,
    emailVerified: true,
  })
  await db.insert(teams).values({
    id: teamId,
    slug: `team-${suffix}`,
    name: 'Agent Jobs Team',
  })
  await db.insert(teamMembers).values({
    id: `member-${suffix}`,
    teamId,
    userId,
    role: 'owner',
  })
  await db.insert(servers).values({
    id: serverId,
    teamId,
    name: `server-${suffix}`,
    handle: `server-${suffix}`,
    status: 'connected',
    agentCredentialHash: hashToken(token),
  })
  await db.insert(projects).values({
    id: projectId,
    teamId,
    slug: `project-${suffix}`,
    name: 'Agent Jobs Project',
    githubRepo: 'acme/app',
  })
  await db.insert(environments).values({
    id: environmentId,
    projectId,
    serverId,
    name: 'Production',
    slug: 'production',
    branch: 'main',
    isProduction: true,
    runtimeId: `dp_${suffix.slice(0, 12)}`,
  })
  await db.insert(deployments).values({
    id: deploymentId,
    environmentId,
    serverId,
    status: 'running',
    phase: 'revision_started',
    trigger: 'user',
    repoId: 1,
    repoFullName: 'acme/app',
    gitSha: 'abc1234',
    gitBranch: 'main',
    config: {
      schemaVersion: 1,
      runtime: {
        type: 'compose',
        path: 'compose.yml',
        releaseCommand: null,
        releaseService: 'web',
        readinessPath: null,
        deployCommand: null,
        rollbackCommand: null,
        timeoutSeconds: 1800,
      },
      routes: [],
    },
    envVars: '[]',
    runtimeId: `dp_${suffix.slice(0, 12)}`,
  })
  await db.insert(aliases).values({
    id: hostnameId,
    hostname: `project-${suffix}.devpush.local`,
    projectId,
    environmentId,
    type: 'environment',
  })

  return {
    deploymentId,
    userId,
    teamSlug: `team-${suffix}`,
    projectName: `project-${suffix}`,
    environmentId,
    hostnameId,
    projectId,
    serverId,
    token,
  }
}

async function cleanupRows() {
  if (touchedArtifactIds.length > 0) {
    await db
      .delete(backupArtifacts)
      .where(inArray(backupArtifacts.id, touchedArtifactIds))
    touchedArtifactIds.length = 0
  }

  if (touchedAgentJobIds.length > 0) {
    await db.delete(agentJobs).where(inArray(agentJobs.id, touchedAgentJobIds))
    touchedAgentJobIds.length = 0
  }

  if (touchedBackupRunIds.length > 0) {
    await db
      .delete(backupRuns)
      .where(inArray(backupRuns.id, touchedBackupRunIds))
    touchedBackupRunIds.length = 0
  }

  if (touchedDeploymentIds.length > 0) {
    await logsDb
      .delete(deploymentLogs)
      .where(inArray(deploymentLogs.deploymentId, touchedDeploymentIds))
    await db
      .delete(deployments)
      .where(inArray(deployments.id, touchedDeploymentIds))
    touchedDeploymentIds.length = 0
  }

  if (touchedHostnameIds.length > 0) {
    await db.delete(aliases).where(inArray(aliases.id, touchedHostnameIds))
    touchedHostnameIds.length = 0
  }

  if (touchedEnvironmentIds.length > 0) {
    await db
      .delete(environments)
      .where(inArray(environments.id, touchedEnvironmentIds))
    touchedEnvironmentIds.length = 0
  }

  if (touchedProjectIds.length > 0) {
    await db.delete(projects).where(inArray(projects.id, touchedProjectIds))
    touchedProjectIds.length = 0
  }

  if (touchedInstallationIds.length > 0) {
    await db
      .delete(githubInstallations)
      .where(
        inArray(githubInstallations.installationId, touchedInstallationIds),
      )
    touchedInstallationIds.length = 0
  }

  if (touchedServerIds.length > 0) {
    await db.delete(servers).where(inArray(servers.id, touchedServerIds))
    touchedServerIds.length = 0
  }

  if (touchedTeamIds.length > 0) {
    await db
      .delete(teamMembers)
      .where(inArray(teamMembers.teamId, touchedTeamIds))
    await db.delete(teams).where(inArray(teams.id, touchedTeamIds))
    touchedTeamIds.length = 0
  }

  if (touchedUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, touchedUserIds))
    touchedUserIds.length = 0
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
