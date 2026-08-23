import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import {
  claimNextDeploymentJob,
  completeDeploymentJob,
  recordDeploymentProgress,
} from '@/server/agents/jobs'
import {
  currentAgentCapabilities,
  currentAgentProtocolVersion,
} from '@/server/agents/compatibility'
import { db } from '@/server/db'
import {
  aliases,
  environments,
  deployments,
  deploymentLogs,
  githubInstallations,
  projects,
  servers,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import {
  createDeploymentsForGitHubPush,
  createManualDeployment,
  getProjectContext,
} from '@/server/projects/service'
import {
  buildRuntimeId,
  encryptDeploymentEnvVars,
} from '@/server/projects/deployment-config'
import { createComposeRuntimeConfig } from '@/server/projects/runtime-config'
import {
  createPendingServer,
  recordAgentHeartbeat,
  registerAgent,
} from '@/server/servers/service'

function extractAgentToken(installCommand: string) {
  const match = installCommand.match(/\/api\/install\/agent\/([^'\s|]+)/)

  if (!match?.[1]) {
    throw new Error('Unable to extract enrollment token from install command.')
  }

  return decodeURIComponent(match[1])
}

function hasCommitMessage(value: unknown, message: string) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    value.message === message
  )
}

async function main() {
  const suffix = randomUUID().slice(0, 8)
  const userId = `smoke-user-${suffix}`
  const teamId = `smoke-team-${suffix}`
  const teamSlug = `smoke-${suffix}`
  const serverName = `smoke-server-${suffix}`
  const projectId = `smoke-project-${suffix}`
  const projectName = `smoke-app-${suffix}`
  const environmentId = `smoke-env-${suffix}`
  const brokenProjectId = `smoke-broken-project-${suffix}`
  const brokenProjectSlug = `smoke-broken-app-${suffix}`
  const brokenEnvironmentId = `smoke-broken-env-${suffix}`
  const installationId = 9_000_000_000 + Number.parseInt(suffix.slice(0, 6), 16)

  try {
    await db.insert(user).values({
      id: userId,
      name: 'Smoke Test',
      username: `smoke-${suffix}`,
      email: `smoke-${suffix}@devpush.local`,
      emailVerified: true,
    })
    await db.insert(teams).values({
      id: teamId,
      slug: teamSlug,
      name: `Smoke ${suffix}`,
    })
    await db.insert(teamMembers).values({
      id: `smoke-member-${suffix}`,
      teamId,
      userId,
      role: 'owner',
    })

    const createdServer = await createPendingServer({
      userId,
      teamSlug,
      name: serverName,
    })
    let token = extractAgentToken(createdServer.installCommand)

    await db.insert(githubInstallations).values({
      installationId,
      accountLogin: 'devpush-smoke',
      accountType: 'User',
      repositorySelection: 'selected',
      status: 'active',
    })
    await db.insert(projects).values({
      id: projectId,
      teamId,
      slug: projectName,
      name: `Smoke app ${suffix}`,
      githubRepoId: 123456789,
      githubRepo: 'devpush/smoke-compose',
      githubInstallationId: installationId,
      runtimeConfig: createComposeRuntimeConfig({
        path: 'compose.yml',
        releaseCommand: 'echo release',
      }),
      routes: [{ path: '/', service: 'web', port: 3000, stripPrefix: false }],
      envVars: [{ key: 'SMOKE_VALUE', value: 'ok', environment: '' }],
    })
    await db.insert(environments).values({
      id: environmentId,
      projectId,
      serverId: createdServer.id,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      isProduction: true,
      runtimeId: buildRuntimeId({ projectId, environmentId }),
    })
    await db.insert(aliases).values({
      id: `smoke-hostname-${suffix}`,
      projectId,
      hostname: `${projectName}.devpush.local`,
      type: 'environment',
      environmentId,
      https: false,
    })

    await expectDeploymentToFail({
      environmentId,
      userId,
      teamSlug,
      projectName,
      message: 'Wait until the assigned server is connected before deploying.',
    })

    const registration = await registerAgent({
      token,
      agentVersion: 'smoke',
      capabilities: [...currentAgentCapabilities],
      protocolVersion: currentAgentProtocolVersion,
      publicAddress: '203.0.113.10',
    })
    token = registration.credential ?? token

    const registeredServerRows = await db
      .select()
      .from(servers)
      .where(eq(servers.id, registration.serverId))
      .limit(1)

    if (registeredServerRows.at(0)?.publicAddress !== '203.0.113.10') {
      throw new Error('Expected agent public address to be persisted.')
    }

    await recordAgentHeartbeat({
      serverId: registration.serverId,
      token,
      agentVersion: 'smoke',
      capabilities: [...currentAgentCapabilities],
      protocolVersion: currentAgentProtocolVersion,
      publicAddress: null,
    })
    const heartbeatServerRows = await db
      .select()
      .from(servers)
      .where(eq(servers.id, registration.serverId))
      .limit(1)

    if (heartbeatServerRows.at(0)?.publicAddress !== '203.0.113.10') {
      throw new Error(
        'Expected heartbeat without address to preserve public address.',
      )
    }

    const canceledDeployment = await createManualDeployment({
      environmentId,
      gitBranch: 'main',
      userId,
      teamSlug,
      projectName,
    })

    const deployment = await createManualDeployment({
      environmentId,
      gitBranch: 'main',
      userId,
      teamSlug,
      projectName,
    })

    const canceledDeploymentRows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, canceledDeployment.deploymentId))
      .limit(1)

    if (canceledDeploymentRows.at(0)?.status !== 'canceled') {
      throw new Error('Expected superseded deployment to be canceled.')
    }

    const accessTokenRequests: Array<{
      installationId: number
      repositoryId: number | null
    }> = []
    const job = await claimNextDeploymentJob({
      serverId: registration.serverId,
      token,
      createAccessToken: async (request) => {
        accessTokenRequests.push(request)

        return {
          token: 'smoke-github-token',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }
      },
    })

    if (!job) {
      throw new Error('Expected queued deployment job to be claimed.')
    }

    if (job.id !== deployment.deploymentId) {
      throw new Error(
        `Claimed unexpected deployment ${job.id}; expected ${deployment.deploymentId}.`,
      )
    }

    if (job.envVars.at(0)?.key !== 'SMOKE_VALUE') {
      throw new Error('Expected environment variables in claimed job.')
    }

    if (
      accessTokenRequests.length !== 1 ||
      accessTokenRequests[0]?.installationId !== installationId ||
      accessTokenRequests[0]?.repositoryId !== 123456789
    ) {
      throw new Error(
        'Expected GitHub token request to be scoped to the repository.',
      )
    }

    await recordDeploymentProgress({
      serverId: registration.serverId,
      token,
      progress: {
        deploymentId: job.id,
        logStartSeq: job.logStartSeq,
        logs: ['smoke progress log 1', 'smoke progress log 2'],
        events: [
          {
            phase: 'compose_resolved',
            message: 'Smoke Compose file resolved.',
          },
        ],
      },
    })

    await completeDeploymentJob({
      serverId: registration.serverId,
      token,
      completion: {
        deploymentId: job.id,
        status: 'succeeded',
        gitSha: 'abc1234',
        logStartSeq: job.logStartSeq + 2,
        logs: ['smoke deploy log'],
        events: [
          {
            phase: 'completed',
            message: 'Smoke deployment completed.',
          },
        ],
      },
    })

    const deploymentRows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deployment.deploymentId))
      .limit(1)
    const deploymentRow = deploymentRows.at(0)
    const logRows = await db
      .select()
      .from(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, deployment.deploymentId))

    if (!deploymentRow) {
      throw new Error('Expected deployment row to exist.')
    }

    if (deploymentRow.status !== 'succeeded') {
      throw new Error(
        `Expected succeeded deployment, got ${deploymentRow.status}.`,
      )
    }

    const expectedLogRows = [
      { seq: job.logStartSeq, content: 'smoke progress log 1' },
      { seq: job.logStartSeq + 1, content: 'smoke progress log 2' },
      { seq: job.logStartSeq + 2, content: 'smoke deploy log' },
    ]
    for (const expected of expectedLogRows) {
      if (
        !logRows.some(
          (row) => row.seq === expected.seq && row.content === expected.content,
        )
      ) {
        throw new Error(
          `Expected deployment log seq ${expected.seq} to contain ${expected.content}.`,
        )
      }
    }

    if (
      !logRows.some(
        (row) =>
          row.seq === job.logStartSeq - 1 && row.content.includes('Queued'),
      )
    ) {
      throw new Error('Expected initial queued log chunk to be persisted.')
    }

    if (logRows.length !== expectedLogRows.length + 1) {
      throw new Error(
        `Expected exactly ${expectedLogRows.length + 1} deployment logs, got ${logRows.length}.`,
      )
    }

    if (deploymentRow.phase !== 'completed') {
      throw new Error(`Expected completed phase, got ${deploymentRow.phase}.`)
    }

    const pushResult = await createDeploymentsForGitHubPush({
      installationId,
      repositoryId: 123456789,
      repositoryFullName: 'devpush/smoke-compose',
      branch: 'main',
      gitSha: 'feed1234',
      message: 'Webhook smoke deploy',
    })

    if (pushResult.created.length !== 1 || pushResult.matched !== 1) {
      throw new Error(
        `Expected GitHub push to queue one deployment, got ${JSON.stringify(pushResult)}.`,
      )
    }

    const pushDeploymentId = pushResult.created[0].deploymentId
    const pushDeploymentRows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, pushDeploymentId))
      .limit(1)
    const pushDeploymentRow = pushDeploymentRows.at(0)

    if (!pushDeploymentRow) {
      throw new Error('Expected GitHub push deployment row to exist.')
    }

    if (
      pushDeploymentRow.status !== 'queued' ||
      pushDeploymentRow.gitSha !== 'feed1234' ||
      !hasCommitMessage(pushDeploymentRow.commitMeta, 'Webhook smoke deploy') ||
      pushDeploymentRow.trigger !== 'webhook'
    ) {
      throw new Error(
        `Unexpected GitHub push deployment: ${JSON.stringify(pushDeploymentRow)}.`,
      )
    }

    const duplicatePushResult = await createDeploymentsForGitHubPush({
      installationId,
      repositoryId: 123456789,
      repositoryFullName: 'devpush/smoke-compose',
      branch: 'main',
      gitSha: 'feed5678',
      message: 'Duplicate webhook smoke deploy',
    })

    if (
      duplicatePushResult.created.length !== 1 ||
      duplicatePushResult.matched !== 1 ||
      duplicatePushResult.skipped.length !== 0
    ) {
      throw new Error(
        `Expected duplicate GitHub push deployment to queue a replacement, got ${JSON.stringify(duplicatePushResult)}.`,
      )
    }

    const canceledPushDeploymentRows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, pushDeploymentId))
      .limit(1)

    if (canceledPushDeploymentRows.at(0)?.status !== 'canceled') {
      throw new Error('Expected superseded GitHub push deployment to cancel.')
    }

    const duplicatePushDeploymentId =
      duplicatePushResult.created[0].deploymentId

    await db
      .update(deployments)
      .set({ status: 'canceled', finishedAt: new Date() })
      .where(eq(deployments.id, duplicatePushDeploymentId))

    await expectCompletionToFail({
      serverId: registration.serverId,
      token,
      deploymentId: deployment.deploymentId,
      message: 'Deployment is not running.',
    })

    await db.insert(projects).values({
      id: brokenProjectId,
      teamId,
      slug: brokenProjectSlug,
      name: `Broken smoke app ${suffix}`,
      githubRepoId: 987654321,
      githubRepo: 'devpush/broken-smoke-compose',
      runtimeConfig: createComposeRuntimeConfig({ path: 'compose.yml' }),
      routes: [{ path: '/', service: 'web', port: 3000, stripPrefix: false }],
    })
    await db.insert(environments).values({
      id: brokenEnvironmentId,
      projectId: brokenProjectId,
      serverId: registration.serverId,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      isProduction: true,
      runtimeId: buildRuntimeId({
        projectId: brokenProjectId,
        environmentId: brokenEnvironmentId,
      }),
    })
    await db.insert(aliases).values({
      id: `smoke-broken-hostname-${suffix}`,
      projectId: brokenProjectId,
      environmentId: brokenEnvironmentId,
      hostname: `${brokenProjectSlug}.devpush.local`,
      type: 'environment',
      https: false,
    })
    const brokenDeploymentId = `smoke-broken-deployment-${suffix}`
    await db.insert(deployments).values({
      id: brokenDeploymentId,
      environmentId: brokenEnvironmentId,
      serverId: registration.serverId,
      status: 'queued',
      phase: 'queued',
      trigger: 'user',
      repoId: 987654321,
      repoFullName: 'devpush/broken-smoke-compose',
      gitSha: 'broken-sha',
      gitBranch: 'main',
      commitMeta: {
        message: 'Broken smoke deployment',
        authorName: null,
        authoredAt: null,
        url: null,
      },
      config: {
        schemaVersion: 1,
        runtime: {
          type: 'compose',
          path: 'compose.yml',
          strategy: 'managed',
          releaseCommand: null,
          releaseService: 'web',
          readinessPath: null,
          deployCommand: null,
          rollbackCommand: null,
          timeoutSeconds: 1800,
        },
        routes: [
          {
            host: `${brokenProjectSlug}.devpush.local`,
            service: 'web',
            port: 3000,
            path: '/',
            https: false,
            stripPrefix: false,
          },
        ],
      },
      envVars: encryptDeploymentEnvVars([]),
      runtimeId: buildRuntimeId({
        projectId: brokenProjectId,
        environmentId: brokenEnvironmentId,
      }),
    })
    const missingInstallJob = await claimNextDeploymentJob({
      serverId: registration.serverId,
      token,
      createAccessToken: async () => ({
        token: 'unused',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    })

    if (missingInstallJob) {
      throw new Error(
        'Expected missing GitHub installation deployment to fail.',
      )
    }

    const brokenDeploymentRows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, brokenDeploymentId))
      .limit(1)
    const brokenLogRows = await db
      .select()
      .from(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, brokenDeploymentId))
    const brokenDeploymentRow = brokenDeploymentRows.at(0)

    if (brokenDeploymentRow?.status !== 'failed') {
      throw new Error(
        'Expected missing GitHub installation deployment to fail.',
      )
    }

    if (
      !brokenLogRows.some(
        (row) =>
          row.content === 'Project is missing a GitHub App installation.',
      )
    ) {
      throw new Error('Expected missing GitHub installation failure log.')
    }

    if (
      brokenDeploymentRow.errorMessage !==
      'Project is missing a GitHub App installation.'
    ) {
      throw new Error(
        'Expected missing GitHub installation failure error message.',
      )
    }

    const staleDeploymentId = `smoke-stale-${suffix}`
    await db.insert(deployments).values({
      id: staleDeploymentId,
      environmentId,
      serverId: registration.serverId,
      status: 'running',
      phase: 'deploy',
      trigger: 'user',
      repoId: 123456789,
      repoFullName: 'devpush/smoke-compose',
      gitSha: 'pending',
      gitBranch: 'main',
      commitMeta: {
        message: 'Stale smoke deployment',
        authorName: null,
        authoredAt: null,
        url: null,
      },
      config: {
        schemaVersion: 1,
        runtime: {
          type: 'compose',
          path: 'compose.yml',
          strategy: 'managed',
          releaseCommand: 'echo release',
          releaseService: 'web',
          readinessPath: null,
          deployCommand: null,
          rollbackCommand: null,
          timeoutSeconds: 1800,
        },
        routes: [
          {
            host: `${projectName}.devpush.local`,
            service: 'web',
            port: 3000,
            path: '/',
            https: false,
            stripPrefix: false,
          },
        ],
      },
      envVars: encryptDeploymentEnvVars([{ key: 'SMOKE_VALUE', value: 'ok' }]),
      runtimeId: buildRuntimeId({ projectId, environmentId }),
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })

    await getProjectContext({ userId, teamSlug, projectName })

    const staleDeploymentRows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, staleDeploymentId))
      .limit(1)
    const staleLogRows = await db
      .select()
      .from(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, staleDeploymentId))
    const staleMessage =
      'Deployment timed out after the agent stopped reporting.'

    if (staleDeploymentRows.at(0)?.status !== 'failed') {
      throw new Error('Expected stale running deployment to fail on read.')
    }

    if (!staleLogRows.some((row) => row.content === staleMessage)) {
      throw new Error('Expected stale deployment timeout log.')
    }

    if (staleDeploymentRows.at(0)?.errorMessage !== staleMessage) {
      throw new Error('Expected stale deployment timeout error message.')
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          teamSlug,
          serverId: registration.serverId,
          deploymentId: deployment.deploymentId,
          status: deploymentRow.status,
          deploymentLogs: logRows.length,
        },
        null,
        2,
      ),
    )
  } finally {
    await cleanup({ teamId, userId })
  }
}

async function expectDeploymentToFail({
  environmentId,
  userId,
  teamSlug,
  projectName,
  message,
}: {
  environmentId: string
  userId: string
  teamSlug: string
  projectName: string
  message: string
}) {
  try {
    await createManualDeployment({
      environmentId,
      gitBranch: 'main',
      userId,
      teamSlug,
      projectName,
    })
  } catch (error) {
    if (error instanceof Error && error.message === message) {
      return
    }

    throw error
  }

  throw new Error('Expected deployment creation to fail.')
}

async function expectCompletionToFail({
  serverId,
  token,
  deploymentId,
  message,
}: {
  serverId: string
  token: string
  deploymentId: string
  message: string
}) {
  try {
    await completeDeploymentJob({
      serverId,
      token,
      completion: {
        deploymentId,
        status: 'succeeded',
        gitSha: 'late-sha',
        logs: ['late completion'],
        events: [
          {
            phase: 'completed',
            message: 'Late completion should not be accepted.',
          },
        ],
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === message) {
      return
    }

    throw error
  }

  throw new Error('Expected deployment completion to fail.')
}

async function cleanup({ teamId, userId }: { teamId: string; userId: string }) {
  try {
    await db.delete(projects).where(eq(projects.teamId, teamId))
    await db.delete(servers).where(eq(servers.teamId, teamId))
    await db.delete(teams).where(eq(teams.id, teamId))
    await db.delete(user).where(eq(user.id, userId))
  } catch (error) {
    console.error(
      'Smoke cleanup failed:',
      error instanceof Error ? error.message : error,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
