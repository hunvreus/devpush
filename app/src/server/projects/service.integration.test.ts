import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import {
  agentJobs,
  deployments,
  environments,
  githubInstallations,
  hostnames,
  projectServers,
  projects,
  servers,
  teamMembers,
  teams,
  user,
} from '@/server/db/schema'
import {
  createDeploymentsForGitHubPush,
  createRedeployDeployment,
  createRollbackDeployment,
  deleteProject,
  updateProjectSettings,
  updateProjectEnvironments,
} from './service'
import {
  decryptDeploymentEnvVars,
  parseDeploymentConfigSnapshot,
} from './deployment-snapshot'

const touchedJobIds: Array<string> = []
const touchedInstallationIds: Array<number> = []
const touchedHostnameIds: Array<string> = []
const touchedDeploymentIds: Array<string> = []
const touchedEnvironmentIds: Array<string> = []
const touchedProjectServerIds: Array<string> = []
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

describe('project settings integration', () => {
  test('project machine names must be unique within a team', async () => {
    const { ownerId, projectName, teamId, teamSlug } =
      await createProjectFixture()
    const duplicateProjectId = makeId('project')
    touchedProjectIds.push(duplicateProjectId)

    await db.insert(projects).values({
      id: duplicateProjectId,
      composePath: 'compose.yml',
      githubRepo: 'example/duplicate-project',
      name: 'duplicate-project',
      slug: 'duplicate-project',
      teamId,
    })

    await expect(
      updateProjectSettings({
        userId: ownerId,
        teamSlug,
        currentProjectName: projectName,
        projectName: 'duplicate-project',
        repoFullName: 'example/project',
        installationId: null,
        composePath: 'compose.current.yml',
        releaseCommand: 'current-release',
        readinessPath: '/current-health',
      }),
    ).rejects.toThrow('Project names must be unique within a team.')
  })

  test('only owners and admins can delete projects', async () => {
    const { memberId, projectName, teamSlug } = await createProjectFixture()

    await expect(
      deleteProject({
        userId: memberId,
        teamSlug,
        projectName,
        confirmationName: projectName,
      }),
    ).rejects.toThrow('Only team owners and admins can delete projects.')
  })

  test('deleting a project cancels active deployments and queues runtime cleanup', async () => {
    const {
      ownerId,
      projectId,
      projectName,
      runningDeploymentId,
      queuedDeploymentId,
      succeededDeploymentId,
      serverId,
      teamSlug,
    } = await createProjectFixture()

    await deleteProject({
      userId: ownerId,
      teamSlug,
      projectName,
      confirmationName: projectName,
    })

    const projectRows = await db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId))
    const deploymentRows = await db
      .select({
        id: deployments.id,
        status: deployments.status,
        phase: deployments.phase,
        errorMessage: deployments.errorMessage,
        finishedAt: deployments.finishedAt,
      })
      .from(deployments)
      .where(
        inArray(deployments.id, [
          queuedDeploymentId,
          runningDeploymentId,
          succeededDeploymentId,
        ]),
      )
    const hostnameRows = await db
      .select({ status: hostnames.status })
      .from(hostnames)
      .where(eq(hostnames.projectId, projectId))
    const jobRows = await db
      .select({
        id: agentJobs.id,
        type: agentJobs.type,
        status: agentJobs.status,
        serverId: agentJobs.serverId,
        projectId: agentJobs.projectId,
        payload: agentJobs.payload,
        availableAt: agentJobs.availableAt,
      })
      .from(agentJobs)
      .where(eq(agentJobs.projectId, projectId))
    touchedJobIds.push(...jobRows.map((row) => row.id))

    const deploymentById = new Map(
      deploymentRows.map((deployment) => [deployment.id, deployment]),
    )
    const queuedDeployment = deploymentById.get(queuedDeploymentId)
    const runningDeployment = deploymentById.get(runningDeploymentId)
    const succeededDeployment = deploymentById.get(succeededDeploymentId)

    expect(projectRows).toEqual([{ status: 'deleted' }])
    expect(queuedDeployment).toMatchObject({
      status: 'canceled',
      phase: 'canceled',
      errorMessage: 'Canceled because the project was deleted.',
    })
    expect(queuedDeployment?.finishedAt).toBeInstanceOf(Date)
    expect(runningDeployment).toMatchObject({
      status: 'canceled',
      phase: 'canceled',
      errorMessage: 'Canceled because the project was deleted.',
    })
    expect(runningDeployment?.finishedAt).toBeInstanceOf(Date)
    expect(succeededDeployment).toMatchObject({
      status: 'succeeded',
      phase: 'complete',
      errorMessage: null,
    })
    expect(hostnameRows).toEqual([{ status: 'disabled' }])
    expect(jobRows).toHaveLength(2)
    const deprovisionJob = jobRows.find((job) => job.type === 'deprovision')
    const purgeJob = jobRows.find((job) => job.type === 'purge')

    expect(deprovisionJob).toMatchObject({
      type: 'deprovision',
      status: 'queued',
      serverId,
      projectId,
    })
    expect(deprovisionJob?.payload).toMatchObject({
      schemaVersion: 1,
      removeVolumes: false,
      reason: 'Project deleted.',
      runtimeIds: expect.arrayContaining([
        'runtime-production',
        'runtime-queued',
        'runtime-running',
        'runtime-succeeded',
      ]),
    })
    expect(purgeJob).toMatchObject({
      type: 'purge',
      status: 'queued',
      serverId,
      projectId,
    })
    expect(purgeJob?.payload).toMatchObject({
      schemaVersion: 1,
      removeVolumes: true,
      runtimeIds: expect.arrayContaining([
        'runtime-production',
        'runtime-queued',
        'runtime-running',
        'runtime-succeeded',
      ]),
    })
    expect(purgeJob?.availableAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('deleting a project can leave deployed runtimes intact', async () => {
    const {
      ownerId,
      projectId,
      projectName,
      runningDeploymentId,
      queuedDeploymentId,
      teamSlug,
    } = await createProjectFixture()

    await deleteProject({
      userId: ownerId,
      teamSlug,
      projectName,
      confirmationName: projectName,
      removeDeployments: false,
    })

    const projectRows = await db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId))
    const deploymentRows = await db
      .select({
        id: deployments.id,
        status: deployments.status,
        phase: deployments.phase,
        errorMessage: deployments.errorMessage,
      })
      .from(deployments)
      .where(inArray(deployments.id, [queuedDeploymentId, runningDeploymentId]))
    const jobRows = await db
      .select({ id: agentJobs.id })
      .from(agentJobs)
      .where(eq(agentJobs.projectId, projectId))

    expect(projectRows).toEqual([{ status: 'deleted' }])
    expect(deploymentRows).toHaveLength(2)
    expect(deploymentRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: queuedDeploymentId,
          status: 'canceled',
          phase: 'canceled',
          errorMessage: 'Canceled because the project was deleted.',
        }),
        expect.objectContaining({
          id: runningDeploymentId,
          status: 'canceled',
          phase: 'canceled',
          errorMessage: 'Canceled because the project was deleted.',
        }),
      ]),
    )
    expect(jobRows).toEqual([])
  })

  test('rollback reuses the source deployment snapshot and env vars', async () => {
    const { ownerId, projectId, projectName, succeededDeploymentId, teamSlug } =
      await createProjectFixture()

    const rollback = await createRollbackDeployment({
      deploymentId: succeededDeploymentId,
      userId: ownerId,
      teamSlug,
      projectName,
    })
    touchedDeploymentIds.push(rollback.deploymentId)

    const rollbackRows = await db
      .select({ deployment: deployments })
      .from(deployments)
      .where(eq(deployments.id, rollback.deploymentId))
    const rollbackDeployment = rollbackRows.at(0)?.deployment

    if (!rollbackDeployment) {
      throw new Error('Rollback deployment was not created.')
    }

    const snapshot = parseDeploymentConfigSnapshot(
      rollbackDeployment.configSnapshot,
    )
    const hostnameRows = await db
      .select({ id: hostnames.id, hostname: hostnames.hostname })
      .from(hostnames)
      .where(eq(hostnames.deploymentId, rollback.deploymentId))
    touchedHostnameIds.push(...hostnameRows.map((hostname) => hostname.id))

    expect(rollbackDeployment).toMatchObject({
      trigger: 'rollback',
      repoId: 123,
      repoFullName: 'example/old-project',
      gitSha: succeededDeploymentId,
      gitBranch: 'release/old',
      envVarsSnapshot: 'encrypted-old-env-vars',
      runtimeId: 'runtime-succeeded',
    })
    expect(snapshot).toMatchObject({
      repo: {
        fullName: 'example/old-project',
      },
      project: {
        id: projectId,
      },
      compose: {
        path: 'compose.old.yml',
        projectName: 'runtime-succeeded',
        releaseCommand: 'old-release',
        releaseService: 'old-worker',
        readinessPath: '/old-health',
        routes: [
          {
            host: 'old.example.devpush.app',
            path: '/',
            service: 'old-web',
            port: 8080,
          },
        ],
      },
    })
    expect(hostnameRows.at(0)?.hostname).toContain('old-project')
  })

  test('redeploy reuses the source deployment snapshot and env vars', async () => {
    const { ownerId, projectId, projectName, succeededDeploymentId, teamSlug } =
      await createProjectFixture()

    const redeploy = await createRedeployDeployment({
      deploymentId: succeededDeploymentId,
      userId: ownerId,
      teamSlug,
      projectName,
    })
    touchedDeploymentIds.push(redeploy.deploymentId)

    const redeployRows = await db
      .select({ deployment: deployments })
      .from(deployments)
      .where(eq(deployments.id, redeploy.deploymentId))
    const redeployDeployment = redeployRows.at(0)?.deployment

    if (!redeployDeployment) {
      throw new Error('Redeployment was not created.')
    }

    const snapshot = parseDeploymentConfigSnapshot(
      redeployDeployment.configSnapshot,
    )
    const hostnameRows = await db
      .select({ id: hostnames.id, hostname: hostnames.hostname })
      .from(hostnames)
      .where(eq(hostnames.deploymentId, redeploy.deploymentId))
    touchedHostnameIds.push(...hostnameRows.map((hostname) => hostname.id))

    expect(redeployDeployment).toMatchObject({
      trigger: 'user',
      repoId: 123,
      repoFullName: 'example/old-project',
      gitSha: succeededDeploymentId,
      gitBranch: 'release/old',
      envVarsSnapshot: 'encrypted-old-env-vars',
      runtimeId: 'runtime-succeeded',
    })
    expect(snapshot).toMatchObject({
      repo: {
        fullName: 'example/old-project',
      },
      project: {
        id: projectId,
      },
      compose: {
        path: 'compose.old.yml',
        projectName: 'runtime-succeeded',
        releaseCommand: 'old-release',
        releaseService: 'old-worker',
        readinessPath: '/old-health',
        routes: [
          {
            host: 'old.example.devpush.app',
            path: '/',
            service: 'old-web',
            port: 8080,
          },
        ],
      },
    })
    expect(hostnameRows.at(0)?.hostname).toContain('old-project')
  })

  test('push deployments snapshot saved project routes instead of stale environment routes', async () => {
    const { environmentId, projectId, projectName, serverId } =
      await createProjectFixture()
    const installationId = 123_456_789
    const repoId = 987_654_321

    touchedInstallationIds.push(installationId)

    await db.insert(githubInstallations).values({
      installationId,
      accountLogin: 'example',
      accountType: 'Organization',
      repositorySelection: 'selected',
    })
    await db
      .update(projects)
      .set({
        githubInstallationId: installationId,
        githubRepoId: repoId,
        routes: [
          { path: '/', service: 'web', port: 3000, stripPrefix: false },
          { path: '/api', service: 'api', port: 8080, stripPrefix: true },
        ],
      })
      .where(eq(projects.id, projectId))
    await db
      .update(environments)
      .set({
        publicRoutes: [
          {
            host: 'stale.example.devpush.app',
            service: 'stale',
            port: 9999,
            path: '/stale',
            https: true,
            stripPrefix: false,
          },
        ],
      })
      .where(eq(environments.id, environmentId))

    const result = await createDeploymentsForGitHubPush({
      installationId,
      repositoryId: repoId,
      repositoryFullName: 'example/project',
      branch: 'main',
      gitSha: 'abcdef123456',
      message: 'Push deployment',
    })
    const deploymentId = result.created.at(0)?.deploymentId

    if (!deploymentId) {
      throw new Error(`Deployment was not created: ${JSON.stringify(result)}`)
    }

    touchedDeploymentIds.push(deploymentId)

    const rows = await db
      .select({ deployment: deployments })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
    const snapshot = parseDeploymentConfigSnapshot(
      rows.at(0)?.deployment.configSnapshot,
    )

    expect(rows.at(0)?.deployment).toMatchObject({
      serverId,
      runtimeId: 'runtime-production',
      trigger: 'webhook',
    })
    expect(snapshot?.compose.routes).toEqual([
      {
        host: `${projectName}.example.devpush.app`,
        https: true,
        path: '/',
        port: 3000,
        service: 'web',
        stripPrefix: false,
      },
      {
        host: `${projectName}.example.devpush.app`,
        https: true,
        path: '/api',
        port: 8080,
        service: 'api',
        stripPrefix: true,
      },
    ])
  })

  test('push deployments snapshot env vars using environment ids', async () => {
    const { environmentId, projectId, serverId } = await createProjectFixture()
    const installationId = 323_456_789
    const repoId = 787_654_321

    touchedInstallationIds.push(installationId)

    await db.insert(githubInstallations).values({
      installationId,
      accountLogin: 'example',
      accountType: 'Organization',
      repositorySelection: 'selected',
    })
    await db
      .update(projects)
      .set({
        githubInstallationId: installationId,
        githubRepoId: repoId,
        envVars: [
          { key: 'SHARED', value: 'all-envs', environment: '' },
          {
            key: 'DATABASE_URL',
            value: 'slug-value',
            environment: 'production',
          },
          {
            key: 'DATABASE_URL',
            value: 'environment-id-value',
            environment: environmentId,
          },
        ],
      })
      .where(eq(projects.id, projectId))

    const result = await createDeploymentsForGitHubPush({
      installationId,
      repositoryId: repoId,
      repositoryFullName: 'example/project',
      branch: 'main',
      gitSha: 'envvar123456',
      message: 'Push deployment with env vars',
    })
    const deploymentId = result.created.at(0)?.deploymentId

    if (!deploymentId) {
      throw new Error(`Deployment was not created: ${JSON.stringify(result)}`)
    }

    touchedDeploymentIds.push(deploymentId)

    const rows = await db
      .select({ deployment: deployments })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
    const deployment = rows.at(0)?.deployment

    expect(deployment).toMatchObject({
      serverId,
      runtimeId: 'runtime-production',
      trigger: 'webhook',
    })
    expect(decryptDeploymentEnvVars(deployment?.envVarsSnapshot ?? '')).toEqual(
      [
        { key: 'SHARED', value: 'all-envs' },
        { key: 'DATABASE_URL', value: 'environment-id-value' },
      ],
    )
  })

  test('saving a non-production environment creates a runtime row and generated alias', async () => {
    const {
      environmentId,
      ownerId,
      projectId,
      projectName,
      serverId,
      teamSlug,
    } = await createProjectFixture()
    const stagingEnvironmentId = makeId('environment')
    const allServerAssignmentId = makeId('project-server')
    const installationId = 223_456_789
    const repoId = 887_654_321

    touchedEnvironmentIds.push(stagingEnvironmentId)
    touchedProjectServerIds.push(allServerAssignmentId)
    touchedInstallationIds.push(installationId)

    await db.insert(projectServers).values({
      id: allServerAssignmentId,
      environmentId: null,
      projectId,
      serverId,
    })
    await db.insert(githubInstallations).values({
      installationId,
      accountLogin: 'example',
      accountType: 'Organization',
      repositorySelection: 'selected',
    })
    await db
      .update(projects)
      .set({
        githubInstallationId: installationId,
        githubRepoId: repoId,
        routes: [
          { path: '/', service: 'web', port: 3000, stripPrefix: false },
          { path: '/api', service: 'api', port: 8080, stripPrefix: true },
        ],
      })
      .where(eq(projects.id, projectId))

    await updateProjectEnvironments({
      userId: ownerId,
      teamSlug,
      projectName,
      projectEnvironments: [
        {
          id: environmentId,
          name: 'Production',
          slug: 'production',
          branch: 'main',
          color: 'blue',
          status: 'active',
        },
        {
          id: stagingEnvironmentId,
          name: 'Staging',
          slug: 'staging',
          branch: 'develop',
          color: 'violet',
          status: 'active',
        },
      ],
    })

    const [stagingRows, stagingHostnames] = await Promise.all([
      db
        .select()
        .from(environments)
        .where(eq(environments.id, stagingEnvironmentId)),
      db
        .select()
        .from(hostnames)
        .where(eq(hostnames.environmentId, stagingEnvironmentId)),
    ])
    const staging = stagingRows.at(0)
    const stagingAlias = stagingHostnames.find(
      (hostname) => hostname.type === 'environment_alias',
    )

    expect(staging).toMatchObject({
      branch: 'develop',
      name: 'Staging',
      projectId,
      serverId,
      slug: 'staging',
    })
    expect(staging?.runtimeId).toMatch(/^dp_/)
    expect(stagingAlias).toMatchObject({
      projectId,
      status: 'active',
    })
    expect(stagingAlias?.hostname).toContain(`${projectName}-env-staging`)
    expect(staging?.publicRoutes).toEqual([
      {
        host: stagingAlias?.hostname,
        https: true,
        path: '/',
        port: 3000,
        service: 'web',
        stripPrefix: false,
      },
      {
        host: stagingAlias?.hostname,
        https: true,
        path: '/api',
        port: 8080,
        service: 'api',
        stripPrefix: true,
      },
    ])

    const result = await createDeploymentsForGitHubPush({
      installationId,
      repositoryId: repoId,
      repositoryFullName: 'example/project',
      branch: 'develop',
      gitSha: 'feedface123456',
      message: 'Deploy staging',
    })
    const deploymentId = result.created.at(0)?.deploymentId

    if (!deploymentId) {
      throw new Error(`Deployment was not created: ${JSON.stringify(result)}`)
    }

    touchedDeploymentIds.push(deploymentId)

    const deploymentRows = await db
      .select({ deployment: deployments })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
    const snapshot = parseDeploymentConfigSnapshot(
      deploymentRows.at(0)?.deployment.configSnapshot,
    )

    expect(deploymentRows.at(0)?.deployment).toMatchObject({
      environmentId: stagingEnvironmentId,
      serverId,
      trigger: 'webhook',
    })
    expect(snapshot?.environment).toMatchObject({
      id: stagingEnvironmentId,
      name: 'Staging',
      slug: 'staging',
    })
    expect(snapshot?.compose.routes).toEqual(staging?.publicRoutes)
  })
})

async function createProjectFixture() {
  const ownerId = makeId('user')
  const adminId = makeId('user')
  const memberId = makeId('user')
  const teamId = makeId('team')
  const teamSlug = makeSlug(teamId)
  const serverId = makeId('server')
  const projectId = makeId('project')
  const projectName = makeSlug(projectId)
  const environmentId = makeId('environment')
  const projectServerId = makeId('project-server')
  const hostnameId = makeId('hostname')
  const queuedDeploymentId = makeId('deployment')
  const runningDeploymentId = makeId('deployment')
  const succeededDeploymentId = makeId('deployment')
  const now = new Date()

  touchedUserIds.push(ownerId, adminId, memberId)
  touchedTeamIds.push(teamId)
  touchedServerIds.push(serverId)
  touchedProjectIds.push(projectId)
  touchedEnvironmentIds.push(environmentId)
  touchedProjectServerIds.push(projectServerId)
  touchedHostnameIds.push(hostnameId)
  touchedDeploymentIds.push(
    queuedDeploymentId,
    runningDeploymentId,
    succeededDeploymentId,
  )

  await db
    .insert(user)
    .values([makeUser(ownerId), makeUser(adminId), makeUser(memberId)])
  await db.insert(teams).values({
    id: teamId,
    name: 'Project integration team',
    slug: teamSlug,
  })
  await db.insert(teamMembers).values([
    {
      id: makeId('member'),
      role: 'owner',
      teamId,
      userId: ownerId,
    },
    {
      id: makeId('member'),
      role: 'admin',
      teamId,
      userId: adminId,
    },
    {
      id: makeId('member'),
      role: 'member',
      teamId,
      userId: memberId,
    },
  ])
  await db.insert(servers).values({
    id: serverId,
    name: 'Project test server',
    handle: makeSlug(serverId),
    status: 'connected',
    teamId,
    lastSeenAt: now,
  })
  await db.insert(projects).values({
    id: projectId,
    composePath: 'compose.current.yml',
    githubRepo: 'example/project',
    name: projectName,
    readinessPath: '/current-health',
    releaseCommand: 'current-release',
    slug: projectName,
    teamId,
  })
  await db.insert(environments).values({
    id: environmentId,
    branch: 'main',
    defaultHost: 'project.example.devpush.app',
    isProduction: true,
    name: 'Production',
    projectId,
    publicRoutes: [
      {
        host: 'project.example.devpush.app',
        service: 'web',
        port: 3000,
        path: '/',
        https: true,
        stripPrefix: false,
      },
    ],
    runtimeId: 'runtime-production',
    serverId,
    slug: 'production',
  })
  await db.insert(projectServers).values({
    id: projectServerId,
    environmentId,
    projectId,
    serverId,
  })
  await db.insert(deployments).values([
    makeDeployment({
      id: queuedDeploymentId,
      environmentId,
      runtimeId: 'runtime-queued',
      serverId,
      status: 'queued',
    }),
    makeDeployment({
      id: runningDeploymentId,
      environmentId,
      runtimeId: 'runtime-running',
      serverId,
      status: 'running',
      phase: 'deploying',
    }),
    makeDeployment({
      id: succeededDeploymentId,
      environmentId,
      envVarsSnapshot: 'encrypted-old-env-vars',
      gitBranch: 'release/old',
      runtimeId: 'runtime-succeeded',
      serverId,
      snapshot: {
        version: 1,
        repo: {
          id: 123,
          fullName: 'example/old-project',
          installationId: null,
        },
        project: {
          id: projectId,
          slug: 'old-project',
          name: 'old-project',
        },
        environment: {
          id: environmentId,
          name: 'Old Production',
          slug: 'production',
          branch: 'release/old',
          color: 'rose',
          defaultHost: 'old.example.devpush.app',
        },
        server: {
          id: serverId,
          name: 'Old server',
          status: 'connected',
        },
        compose: {
          path: 'compose.old.yml',
          projectName: 'runtime-succeeded',
          releaseCommand: 'old-release',
          releaseService: 'old-worker',
          readinessPath: '/old-health',
          routes: [
            {
              host: 'old.example.devpush.app',
              service: 'old-web',
              port: 8080,
              path: '/',
              https: true,
              stripPrefix: false,
            },
          ],
        },
      },
      status: 'succeeded',
      phase: 'complete',
      finishedAt: now,
    }),
  ])
  await db.insert(hostnames).values({
    id: hostnameId,
    environmentId,
    hostname: `${projectName}.example.devpush.app`,
    projectId,
    status: 'active',
    type: 'environment_alias',
  })

  return {
    adminId,
    memberId,
    ownerId,
    environmentId,
    projectId,
    projectName,
    queuedDeploymentId,
    runningDeploymentId,
    serverId,
    succeededDeploymentId,
    teamId,
    teamSlug,
  }
}

async function cleanupRows() {
  if (touchedJobIds.length > 0) {
    await db.delete(agentJobs).where(inArray(agentJobs.id, touchedJobIds))
  }

  if (touchedHostnameIds.length > 0) {
    await db.delete(hostnames).where(inArray(hostnames.id, touchedHostnameIds))
  }

  if (touchedDeploymentIds.length > 0) {
    await db
      .delete(deployments)
      .where(inArray(deployments.id, touchedDeploymentIds))
  }

  if (touchedProjectServerIds.length > 0) {
    await db
      .delete(projectServers)
      .where(inArray(projectServers.id, touchedProjectServerIds))
  }

  if (touchedEnvironmentIds.length > 0) {
    await db
      .delete(environments)
      .where(inArray(environments.id, touchedEnvironmentIds))
  }

  if (touchedProjectIds.length > 0) {
    await db.delete(projects).where(inArray(projects.id, touchedProjectIds))
  }

  if (touchedInstallationIds.length > 0) {
    await db
      .delete(githubInstallations)
      .where(
        inArray(githubInstallations.installationId, touchedInstallationIds),
      )
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

  touchedJobIds.length = 0
  touchedInstallationIds.length = 0
  touchedHostnameIds.length = 0
  touchedDeploymentIds.length = 0
  touchedEnvironmentIds.length = 0
  touchedProjectServerIds.length = 0
  touchedProjectIds.length = 0
  touchedServerIds.length = 0
  touchedTeamIds.length = 0
  touchedUserIds.length = 0
}

function makeDeployment({
  envVarsSnapshot = '[]',
  environmentId,
  finishedAt,
  gitBranch = 'main',
  id,
  phase,
  runtimeId,
  serverId,
  snapshot = {},
  status,
}: {
  envVarsSnapshot?: string
  environmentId: string
  finishedAt?: Date
  gitBranch?: string
  id: string
  phase?: string
  runtimeId: string
  serverId: string
  snapshot?: unknown
  status: 'queued' | 'running' | 'succeeded'
}) {
  return {
    id,
    commitMeta: {},
    configSnapshot: snapshot,
    environmentId,
    envVarsSnapshot,
    finishedAt,
    gitBranch,
    gitSha: id,
    phase,
    repoFullName: 'example/project',
    runtimeId,
    serverId,
    status,
  }
}

function makeUser(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    emailVerified: true,
    name: id,
    username: makeUsername(id),
  }
}

function makeId(prefix: string) {
  return `it-${prefix}-${crypto.randomUUID()}`
}

function makeSlug(id: string) {
  return id.replaceAll('_', '-').toLowerCase()
}

function makeUsername(id: string) {
  return id.replaceAll('_', '-').toLowerCase().slice(0, 50)
}
