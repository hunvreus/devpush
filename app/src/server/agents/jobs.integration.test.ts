import { createHash } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import {
  agentJobs,
  backupArtifacts,
  backupRuns,
  deployments,
  environments,
  hostnames,
  projects,
  servers,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import {
  completeBackupCleanupJob,
  completeBackupJob,
  completeDeploymentJob,
} from './jobs'

const touchedArtifactIds: Array<string> = []
const touchedAgentJobIds: Array<string> = []
const touchedBackupRunIds: Array<string> = []
const touchedDeploymentIds: Array<string> = []
const touchedEnvironmentIds: Array<string> = []
const touchedHostnameIds: Array<string> = []
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
            message: 'Deployment canceled because a newer deployment was queued.',
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
      errorMessage: 'Deployment canceled because a newer deployment was queued.',
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
        deploymentId: hostnames.deploymentId,
      })
      .from(hostnames)
      .where(eq(hostnames.id, hostnameId))

    expect(rows).toEqual([{ deploymentId }])
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
      retention: {
        daily: 7,
        weekly: 4,
        monthly: 3,
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
      objectKeys: ['expired/manifest.json'],
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
    enrollmentTokenHash: hashToken(token),
    enrollmentTokenExpiresAt: null,
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
    repoFullName: 'acme/app',
    gitSha: 'abc1234',
    gitBranch: 'main',
    configSnapshot: {
      version: 1,
      repo: {
        id: 123,
        fullName: 'acme/app',
        installationId: 456,
      },
      project: {
        id: projectId,
        slug: `project-${suffix}`,
        name: 'Agent Jobs Project',
      },
      environment: {
        id: environmentId,
        name: 'Production',
        slug: 'production',
        branch: 'main',
        color: 'blue',
        defaultHost: null,
      },
      server: {
        id: serverId,
        name: `server-${suffix}`,
        status: 'connected',
      },
      compose: {
        path: 'compose.yml',
        projectName: `dp_${suffix.slice(0, 12)}`,
        releaseCommand: null,
        releaseService: 'web',
        readinessPath: null,
        routes: [],
      },
    },
    envVarsSnapshot: '[]',
    runtimeId: `dp_${suffix.slice(0, 12)}`,
  })
  await db.insert(hostnames).values({
    id: hostnameId,
    hostname: `project-${suffix}.devpush.local`,
    projectId,
    environmentId,
    status: 'active',
    type: 'environment_alias',
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
    await db.delete(hostnames).where(inArray(hostnames.id, touchedHostnameIds))
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

  if (touchedServerIds.length > 0) {
    await db.delete(servers).where(inArray(servers.id, touchedServerIds))
    touchedServerIds.length = 0
  }

  if (touchedTeamIds.length > 0) {
    await db.delete(teamMembers).where(inArray(teamMembers.teamId, touchedTeamIds))
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
