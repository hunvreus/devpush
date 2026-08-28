import { createHash } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import { currentAgentCapabilities } from './compatibility'
import {
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
import {
  claimNextAgentJob,
  completeBackupCleanupJob,
  completeBackupJob,
  completeDeploymentJob,
  completeRestoreJob,
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
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('agent deployment jobs', () => {
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
            objectKey: 'manifest.json',
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
        },
        errorMessage: null,
      },
    ])
    expect(jobRows).toEqual([{ status: 'succeeded', errorMessage: null }])
    expect(artifactRows).toMatchObject([
      {
        type: 'manifest',
        objectKey: 'manifest.json',
      },
    ])
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

    const [runRows, jobRows] = await Promise.all([
      db
        .select({
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
    ])

    expect(runRows.at(0)?.cleanupFinishedAt).toBeInstanceOf(Date)
    expect(runRows.at(0)?.cleanupErrorMessage).toBeNull()
    expect(jobRows).toEqual([{ status: 'succeeded', errorMessage: null }])
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
      localBasePath: '/var/lib/devpush/backups/project/environment/run',
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
  const now = new Date()
  touchedBackupRunIds.push(backupRunId)
  touchedAgentJobIds.push(jobId)

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
          objectKey: '/var/lib/devpush/backups/run/volumes/data.tar.gz',
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
