import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import { currentAgentCapabilities } from '@/server/agents/compatibility'
import {
  agentJobs,
  aliases,
  deployments,
  domains,
  environments,
  githubInstallations,
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
  getDeploymentContext,
  getProjectContext,
  updateProjectEnvironmentServers,
  updateProjectSettings,
  updateProjectEnvironments,
} from './service'
import {
  decryptDeploymentEnvVars,
  parseDeploymentConfig,
} from './deployment-config'
import { createComposeRuntimeConfig } from './runtime-config'

const touchedJobIds: Array<string> = []
const touchedInstallationIds: Array<number> = []
const touchedHostnameIds: Array<string> = []
const touchedDeploymentIds: Array<string> = []
const touchedDomainIds: Array<string> = []
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

describe('project settings integration', () => {
  test('project default servers are inherited and environments can override them', async () => {
    const {
      environmentId,
      ownerId,
      projectId,
      projectName,
      serverId,
      teamId,
      teamSlug,
    } = await createProjectFixture()
    const overrideServerId = makeId('server')
    touchedServerIds.push(overrideServerId)

    await db.insert(servers).values({
      id: overrideServerId,
      name: 'Override server',
      handle: makeSlug(overrideServerId),
      status: 'connected',
      teamId,
      lastSeenAt: new Date(),
    })
    await db
      .update(projects)
      .set({ defaultServerId: serverId })
      .where(eq(projects.id, projectId))
    await db
      .update(environments)
      .set({ serverId: null })
      .where(eq(environments.id, environmentId))

    const inheritedContext = await getProjectContext({
      userId: ownerId,
      teamSlug,
      projectName,
    })

    expect(inheritedContext.project.defaultServerId).toBe(serverId)
    expect(inheritedContext.environments[0]).toMatchObject({
      serverId: null,
      effectiveServerId: serverId,
    })
    expect(inheritedContext.environment.serverId).toBe(serverId)

    const overriddenContext = await updateProjectEnvironmentServers({
      userId: ownerId,
      teamSlug,
      projectName,
      defaultServerId: serverId,
      environmentServers: [{ environmentId, serverId: overrideServerId }],
    })

    expect(overriddenContext.project.defaultServerId).toBe(serverId)
    expect(overriddenContext.environments[0]).toMatchObject({
      serverId: overrideServerId,
      effectiveServerId: overrideServerId,
    })
    expect(overriddenContext.environment.serverId).toBe(overrideServerId)
  })

  test('project environments are returned in persisted priority order', async () => {
    const {
      environmentId,
      ownerId,
      projectId,
      serverId,
      teamSlug,
      projectName,
    } = await createProjectFixture()
    const developmentId = makeId('environment')
    const stagingId = makeId('environment')
    touchedEnvironmentIds.push(developmentId, stagingId)

    await db
      .update(environments)
      .set({ position: 0 })
      .where(eq(environments.id, environmentId))
    await db.insert(environments).values([
      {
        id: stagingId,
        projectId,
        serverId,
        name: 'Staging',
        slug: 'staging',
        branch: 'stg-*',
        position: 2,
        runtimeId: makeId('runtime'),
      },
      {
        id: developmentId,
        projectId,
        serverId,
        name: 'Development',
        slug: 'development',
        branch: 'dev-*',
        position: 1,
        runtimeId: makeId('runtime'),
      },
    ])

    const context = await getProjectContext({
      userId: ownerId,
      teamSlug,
      projectName,
    })

    expect(context.environments.map((environment) => environment.id)).toEqual([
      environmentId,
      developmentId,
      stagingId,
    ])
  })

  test('generated aliases disambiguate custom domain collisions', async () => {
    const {
      environmentId,
      ownerId,
      projectId,
      projectName,
      serverId,
      teamSlug,
    } = await createProjectFixture()
    const domainId = makeId('domain')
    const requestedHostname = `${projectName}-127-0-0-1.nip.io`
    touchedDomainIds.push(domainId)

    await db.insert(domains).values({
      id: domainId,
      environmentId,
      hostname: requestedHostname,
      projectId,
    })

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
          position: 0,
          status: 'active',
          effectiveServerId: serverId,
          serverId,
        },
      ],
    })

    const aliasRows = await db
      .select({ hostname: aliases.hostname })
      .from(aliases)
      .where(eq(aliases.environmentId, environmentId))

    expect(aliasRows).toHaveLength(1)
    expect(aliasRows[0]?.hostname).not.toBe(requestedHostname)
    expect(aliasRows[0]?.hostname).toMatch(/-127-0-0-1\.nip\.io$/)
  })

  test('only verified custom domains receive public routes', async () => {
    const { environmentId, ownerId, projectId, projectName, teamSlug } =
      await createProjectFixture()
    const domainId = makeId('domain')
    const hostname = `${makeSlug(domainId)}.example.com`
    touchedDomainIds.push(domainId)

    await db
      .update(projects)
      .set({
        routes: [{ path: '/', service: 'web', port: 3000, stripPrefix: false }],
      })
      .where(eq(projects.id, projectId))
    await db.insert(domains).values({
      id: domainId,
      environmentId,
      hostname,
      projectId,
      status: 'pending',
    })

    const pendingContext = await getProjectContext({
      userId: ownerId,
      teamSlug,
      projectName,
    })
    expect(
      pendingContext.environment.publicRoutes.some(
        (route) => route.host === hostname,
      ),
    ).toBe(false)

    await db
      .update(domains)
      .set({ status: 'active' })
      .where(eq(domains.id, domainId))

    const activeContext = await getProjectContext({
      userId: ownerId,
      teamSlug,
      projectName,
    })
    expect(
      activeContext.environment.publicRoutes.some(
        (route) => route.host === hostname,
      ),
    ).toBe(true)
  })

  test('project machine names must be unique within a team', async () => {
    const { ownerId, projectName, teamId, teamSlug } =
      await createProjectFixture()
    const duplicateProjectId = makeId('project')
    touchedProjectIds.push(duplicateProjectId)

    await db.insert(projects).values({
      id: duplicateProjectId,
      runtimeConfig: createComposeRuntimeConfig({ path: 'compose.yml' }),
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
        runtimeConfig: createComposeRuntimeConfig({
          path: 'compose.current.yml',
          releaseCommand: 'current-release',
          readinessPath: '/current-health',
        }),
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
      .select({ id: aliases.id })
      .from(aliases)
      .where(eq(aliases.projectId, projectId))
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
    expect(hostnameRows).toEqual([])
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

  test('rollback reuses the source deployment config and env vars', async () => {
    const { ownerId, projectName, succeededDeploymentId, teamSlug } =
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

    const deploymentConfig = parseDeploymentConfig(rollbackDeployment.config)
    const hostnameRows = await db
      .select({ id: aliases.id, hostname: aliases.hostname })
      .from(aliases)
      .where(eq(aliases.deploymentId, rollback.deploymentId))
    touchedHostnameIds.push(...hostnameRows.map((hostname) => hostname.id))

    expect(rollbackDeployment).toMatchObject({
      trigger: 'rollback',
      repoId: 123,
      repoFullName: 'example/old-project',
      gitSha: succeededDeploymentId,
      gitBranch: 'release/old',
      envVars: 'encrypted-old-env-vars',
      runtimeId: 'runtime-succeeded',
    })
    expect(deploymentConfig).toMatchObject({
      runtime: {
        path: 'compose.old.yml',
        releaseCommand: 'old-release',
        releaseService: 'old-worker',
        readinessPath: '/old-health',
      },
    })
    expect(deploymentConfig?.routes).toEqual(
      expect.arrayContaining([
        {
          host: 'old.example.devpush.app',
          https: true,
          path: '/',
          service: 'old-web',
          port: 8080,
          stripPrefix: false,
        },
      ]),
    )
    expect(hostnameRows.at(0)?.hostname).toMatch(
      new RegExp(`^${rollback.deploymentId.slice(0, 7)}-`),
    )
    const context = await getDeploymentContext({
      deploymentId: rollback.deploymentId,
      projectName,
      teamSlug,
      userId: ownerId,
    })
    expect(context.deployment.deploymentHost).toBe(hostnameRows.at(0)?.hostname)
  })

  test('rollback is blocked when the server agent requires an update', async () => {
    const { ownerId, projectName, serverId, succeededDeploymentId, teamSlug } =
      await createProjectFixture()

    await db
      .update(servers)
      .set({ agentCapabilities: [], agentProtocolVersion: null })
      .where(eq(servers.id, serverId))

    await expect(
      createRollbackDeployment({
        deploymentId: succeededDeploymentId,
        userId: ownerId,
        teamSlug,
        projectName,
      }),
    ).rejects.toThrow('Update the deployment server agent before rolling back.')
  })

  test('redeploy reuses the source deployment config and env vars', async () => {
    const { ownerId, projectName, succeededDeploymentId, teamSlug } =
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

    const deploymentConfig = parseDeploymentConfig(redeployDeployment.config)
    const hostnameRows = await db
      .select({ id: aliases.id, hostname: aliases.hostname })
      .from(aliases)
      .where(eq(aliases.deploymentId, redeploy.deploymentId))
    touchedHostnameIds.push(...hostnameRows.map((hostname) => hostname.id))

    expect(redeployDeployment).toMatchObject({
      trigger: 'user',
      repoId: 123,
      repoFullName: 'example/old-project',
      gitSha: succeededDeploymentId,
      gitBranch: 'release/old',
      envVars: 'encrypted-old-env-vars',
      runtimeId: 'runtime-succeeded',
    })
    expect(deploymentConfig).toMatchObject({
      runtime: {
        path: 'compose.old.yml',
        releaseCommand: 'old-release',
        releaseService: 'old-worker',
        readinessPath: '/old-health',
      },
    })
    expect(deploymentConfig?.routes).toEqual(
      expect.arrayContaining([
        {
          host: 'old.example.devpush.app',
          https: true,
          path: '/',
          service: 'old-web',
          port: 8080,
          stripPrefix: false,
        },
      ]),
    )
    expect(hostnameRows.at(0)?.hostname).toMatch(
      new RegExp(`^${redeploy.deploymentId.slice(0, 7)}-`),
    )
  })

  test('push deployments snapshot effective default and environment routes', async () => {
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
        runtimeConfig: createComposeRuntimeConfig({
          path: 'compose.current.yml',
          strategy: 'command',
          deployCommand: './scripts/deploy',
          rollbackCommand: './scripts/rollback',
          timeoutSeconds: 900,
        }),
        routes: [
          { path: '/', service: 'web', port: 3000, stripPrefix: false },
          { path: '/api', service: 'api', port: 8080, stripPrefix: true },
          {
            path: '/api',
            service: 'production-api',
            port: 9090,
            stripPrefix: false,
            environmentId,
          },
        ],
      })
      .where(eq(projects.id, projectId))
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
    const snapshot = parseDeploymentConfig(rows.at(0)?.deployment.config)

    expect(rows.at(0)?.deployment).toMatchObject({
      serverId,
      runtimeId: 'runtime-production',
      trigger: 'webhook',
    })
    expect(snapshot?.routes).toEqual(
      expect.arrayContaining([
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
          port: 9090,
          service: 'production-api',
          stripPrefix: false,
        },
      ]),
    )
    expect(snapshot?.routes).toHaveLength(6)
    expect(snapshot?.runtime).toMatchObject({
      type: 'compose',
      strategy: 'command',
      deployCommand: './scripts/deploy',
      rollbackCommand: './scripts/rollback',
      timeoutSeconds: 900,
    })
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
        routes: [
          {
            path: '/',
            service: 'web',
            port: 80,
            stripPrefix: false,
          },
        ],
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
    expect(decryptDeploymentEnvVars(deployment?.envVars ?? '')).toEqual([
      { key: 'SHARED', value: 'all-envs' },
      { key: 'DATABASE_URL', value: 'environment-id-value' },
    ])
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
    const installationId = 223_456_789
    const repoId = 887_654_321

    touchedEnvironmentIds.push(stagingEnvironmentId)
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
          position: 0,
          status: 'active',
          effectiveServerId: serverId,
          serverId,
        },
        {
          id: stagingEnvironmentId,
          name: 'Staging',
          slug: 'staging',
          branch: 'stg-*',
          color: 'violet',
          position: 1,
          status: 'active',
          effectiveServerId: serverId,
          serverId,
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
        .from(aliases)
        .where(eq(aliases.environmentId, stagingEnvironmentId)),
    ])
    const staging = stagingRows.at(0)
    const stagingAlias = stagingHostnames.find(
      (hostname) => hostname.type === 'environment',
    )

    expect(staging).toMatchObject({
      branch: 'stg-*',
      name: 'Staging',
      projectId,
      serverId,
      slug: 'staging',
    })
    expect(staging?.runtimeId).toMatch(/^dp_/)
    expect(stagingAlias).toMatchObject({
      projectId,
    })
    expect(stagingAlias?.hostname).toMatch(/-env-staging-127-0-0-1\.nip\.io$/)
    const expectedRoutes = [
      {
        host: stagingAlias?.hostname,
        https: false,
        path: '/',
        port: 3000,
        service: 'web',
        stripPrefix: false,
      },
      {
        host: stagingAlias?.hostname,
        https: false,
        path: '/api',
        port: 8080,
        service: 'api',
        stripPrefix: true,
      },
    ]

    const result = await createDeploymentsForGitHubPush({
      installationId,
      repositoryId: repoId,
      repositoryFullName: 'example/project',
      branch: 'stg-preview',
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
    const snapshot = parseDeploymentConfig(
      deploymentRows.at(0)?.deployment.config,
    )

    expect(deploymentRows.at(0)?.deployment).toMatchObject({
      environmentId: stagingEnvironmentId,
      serverId,
      trigger: 'webhook',
    })
    expect(snapshot?.routes).toEqual(expect.arrayContaining(expectedRoutes))
    expect(snapshot?.routes).toHaveLength(6)
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
    agentCapabilities: [...currentAgentCapabilities],
    agentProtocolVersion: 1,
  })
  await db.insert(projects).values({
    id: projectId,
    runtimeConfig: createComposeRuntimeConfig({
      path: 'compose.current.yml',
      readinessPath: '/current-health',
      releaseCommand: 'current-release',
    }),
    githubRepo: 'example/project',
    name: projectName,
    slug: projectName,
    teamId,
  })
  await db.insert(environments).values({
    id: environmentId,
    branch: 'main',
    isProduction: true,
    name: 'Production',
    projectId,
    runtimeId: 'runtime-production',
    serverId,
    slug: 'production',
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
      repoFullName: 'example/old-project',
      repoId: 123,
      envVars: 'encrypted-old-env-vars',
      gitBranch: 'release/old',
      runtimeId: 'runtime-succeeded',
      serverId,
      snapshot: {
        schemaVersion: 1,
        runtime: {
          type: 'compose',
          path: 'compose.old.yml',
          strategy: 'managed',
          releaseCommand: 'old-release',
          releaseService: 'old-worker',
          readinessPath: '/old-health',
          deployCommand: null,
          rollbackCommand: null,
          timeoutSeconds: 1800,
        },
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
      status: 'succeeded',
      phase: 'complete',
      finishedAt: now,
    }),
  ])
  await db.insert(aliases).values({
    id: hostnameId,
    environmentId,
    hostname: `${projectName}.example.devpush.app`,
    projectId,
    type: 'environment',
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
    await db.delete(aliases).where(inArray(aliases.id, touchedHostnameIds))
  }

  if (touchedDomainIds.length > 0) {
    await db.delete(domains).where(inArray(domains.id, touchedDomainIds))
  }

  if (touchedDeploymentIds.length > 0) {
    await db
      .delete(deployments)
      .where(inArray(deployments.id, touchedDeploymentIds))
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
  touchedDomainIds.length = 0
  touchedEnvironmentIds.length = 0
  touchedProjectIds.length = 0
  touchedServerIds.length = 0
  touchedTeamIds.length = 0
  touchedUserIds.length = 0
}

function makeDeployment({
  envVars = '[]',
  environmentId,
  finishedAt,
  gitBranch = 'main',
  id,
  phase,
  repoFullName = 'example/project',
  repoId = 1,
  runtimeId,
  serverId,
  snapshot = {},
  status,
}: {
  envVars?: string
  environmentId: string
  finishedAt?: Date
  gitBranch?: string
  id: string
  phase?: string
  repoFullName?: string
  repoId?: number
  runtimeId: string
  serverId: string
  snapshot?: unknown
  status: 'queued' | 'running' | 'succeeded'
}) {
  return {
    id,
    commitMeta: {},
    config: snapshot,
    environmentId,
    envVars,
    finishedAt,
    gitBranch,
    gitSha: id,
    phase,
    repoFullName,
    repoId,
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
