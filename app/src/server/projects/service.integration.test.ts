import { createHash } from 'node:crypto'
import { registerAgent } from '#devpush/server/servers/service'
import * as GeneratedHostnameModule from './generated-hostname'
import { pruneDeletedResources } from '#devpush/server/deleted-resources'
import { saveBackupStorage } from '#devpush/server/backups/storage'
import { required } from '#devpush/test/required'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'
import * as ProjectContextModule from './context'

import { closeDb, db } from '#devpush/server/db'
import { currentAgentCapabilities } from '#devpush/server/agents/compatibility'
import {
  agentJobs,
  aliases,
  backupArtifacts,
  backupConfigs,
  backupRuns,
  deployments,
  deploymentEvents,
  domains,
  environments,
  githubInstallations,
  projects,
  servers,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'
import {
  createDeploymentsForGitHubPush,
  createRedeployDeployment,
  createRollbackDeployment,
} from './deployments'
import {
  resolveUnavailableDeployment,
  getDeploymentSectionContext,
  getDeploymentLogsContext,
  getProjectContext,
  getProjectSectionContext,
} from './context'
import {
  updateProjectEnvVars,
  updateProjectEnvironments,
  updateProjectEnvironmentServers,
} from './environments'
import {
  createBackupRestoreJob,
  createManualBackupRun,
  saveProjectBackupPolicy,
  deleteProjectBackupPolicy,
} from './backups'
import {
  deleteProject,
  updateProjectDomains,
  updateProjectSettings,
} from './settings'
import {
  decryptDeploymentEnvVars,
  parseDeploymentConfig,
} from './deployment-config'
import { encryptProjectEnvVars } from './project-env-vars'
import { createComposeRuntimeConfig } from '#devpush/lib/project-runtime-config'
import { resolveAvailableAliasHostname } from './hostnames'

const touchedJobIds: Array<string> = []
const touchedBackupRunIds: Array<string> = []
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
  vi.restoreAllMocks()
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('project settings integration', () => {
  test('project shell retains environment and branch routes without including deployment aliases', async () => {
    const f = await createProjectFixture()
    const branchId = makeId('branch-alias')
    const deploymentAliasId = makeId('deployment-alias')
    touchedHostnameIds.push(branchId, deploymentAliasId)
    await db.insert(aliases).values([
      {
        id: branchId,
        projectId: f.projectId,
        environmentId: f.environmentId,
        type: 'branch',
        branch: 'main',
        hostname: `${branchId}.example.test`,
      },
      {
        id: deploymentAliasId,
        projectId: f.projectId,
        environmentId: f.environmentId,
        type: 'deployment',
        deploymentId: f.succeededDeploymentId,
        hostname: `${deploymentAliasId}.example.test`,
      },
    ])
    await db
      .update(projects)
      .set({
        routes: [{ path: '/', service: 'web', port: 3000, stripPrefix: false }],
      })
      .where(eq(projects.id, f.projectId))
    const context = await getProjectContext({
      userId: f.ownerId,
      teamSlug: f.teamSlug,
      projectName: f.projectName,
      scope: 'shell',
    })
    expect(context.environment.defaultHost).toBe(
      `${f.projectName}.example.devpush.app`,
    )
    expect(
      context.environment.publicRoutes.map((route) => route.host),
    ).toContain(`${branchId}.example.test`)
    expect(
      context.environment.publicRoutes.map((route) => route.host),
    ).not.toContain(`${deploymentAliasId}.example.test`)
  })
  test('agent registration restores only successful immutable deployment hosts', async () => {
    const f = await createProjectFixture()
    const aliasId = makeId('historical-alias')
    touchedHostnameIds.push(aliasId)
    await db.insert(aliases).values({
      id: aliasId,
      projectId: f.projectId,
      environmentId: f.environmentId,
      deploymentId: f.succeededDeploymentId,
      type: 'deployment',
      hostname: 'previous.example.test',
      https: true,
    })
    const token = 'dpa_test-inactive-history'
    await db
      .update(servers)
      .set({
        agentCredentialHash: createHash('sha256').update(token).digest('hex'),
      })
      .where(eq(servers.id, f.serverId))
    const response = await registerAgent({
      token,
      publicAddress: null,
      capabilities: ['ingress.inactive-redirects.v1'],
    })
    expect(response.inactiveRedirects).toEqual([
      {
        id: f.succeededDeploymentId,
        host: 'previous.example.test',
        https: true,
      },
    ])
    expect(
      (await registerAgent({ token, publicAddress: null })).inactiveRedirects,
    ).toBeUndefined()
  })

  test('inactive deployment links require current membership and report current serving state', async () => {
    const f = await createProjectFixture()
    expect(
      await resolveUnavailableDeployment(f.ownerId, f.succeededDeploymentId),
    ).toEqual({ teamSlug: f.teamSlug, projectName: f.projectName })
    await expect(
      resolveUnavailableDeployment('outsider', f.succeededDeploymentId),
    ).rejects.toMatchObject({ code: 'DEPLOYMENT_NOT_FOUND' })
    const input = {
      userId: f.ownerId,
      teamSlug: f.teamSlug,
      projectName: f.projectName,
      deploymentId: f.succeededDeploymentId,
    }
    expect(
      (await getDeploymentSectionContext(input)).deployment.isServing,
    ).toBe(false)
    await db
      .update(aliases)
      .set({ deploymentId: f.succeededDeploymentId })
      .where(eq(aliases.environmentId, f.environmentId))
    const activeContext = await getDeploymentSectionContext(input)
    expect(activeContext.deployment.isServing).toBe(true)
    const activeAliases = await db
      .select({
        type: aliases.type,
        hostname: aliases.hostname,
        https: aliases.https,
      })
      .from(aliases)
      .where(eq(aliases.deploymentId, f.succeededDeploymentId))
    expect(activeContext.visitAliases).toEqual(
      expect.arrayContaining(activeAliases),
    )
    expect(activeContext.visitAliases).toHaveLength(activeAliases.length)
    await db.delete(teamMembers).where(eq(teamMembers.userId, f.ownerId))
    await expect(
      resolveUnavailableDeployment(f.ownerId, f.succeededDeploymentId),
    ).rejects.toMatchObject({ code: 'DEPLOYMENT_NOT_FOUND' })
  })

  test('stale policy deletion preserves newer settings', async () => {
    const f = await createProjectFixture()
    const id = makeId('concurrent-policy')
    await db.insert(backupConfigs).values({
      id,
      projectId: f.projectId,
      environmentId: f.environmentId,
      name: 'Concurrent policy',
      schedule: { cron: '0 2 * * *' },
      destination: {},
      retention: {
        local: { count: 7, days: 0, maxStorageGb: 0 },
        remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
      },
    })
    await db
      .update(backupConfigs)
      .set({ name: 'Newer policy' })
      .where(eq(backupConfigs.id, id))
    await expect(
      deleteProjectBackupPolicy({
        userId: f.ownerId,
        teamSlug: f.teamSlug,
        projectName: f.projectName,
        settingsVersion: 1,
        policyId: id,
      }),
    ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    expect(
      await db.select().from(backupConfigs).where(eq(backupConfigs.id, id)),
    ).toHaveLength(1)
  })

  test('demotion after backup context loading prevents the final replacement', async () => {
    const f = await createProjectFixture()
    const id = makeId('protected-policy')
    await db.insert(backupConfigs).values({
      id,
      projectId: f.projectId,
      environmentId: f.environmentId,
      name: 'Protected policy',
      schedule: { cron: '0 2 * * *' },
      destination: {},
      retention: {
        local: { count: 7, days: 0, maxStorageGb: 0 },
        remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
      },
    })
    const original = ProjectContextModule.getProjectContext
    const contextRead = vi
      .spyOn(ProjectContextModule, 'getProjectContext')
      .mockImplementationOnce(async (params) => {
        const context = await original(params)
        await db
          .update(teamMembers)
          .set({ role: 'member' })
          .where(eq(teamMembers.userId, f.adminId))
        return context
      })
    try {
      await expect(
        deleteProjectBackupPolicy({
          userId: f.adminId,
          teamSlug: f.teamSlug,
          projectName: f.projectName,
          settingsVersion: 1,
          policyId: id,
        }),
      ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
      expect(
        await db.select().from(backupConfigs).where(eq(backupConfigs.id, id)),
      ).toHaveLength(1)
    } finally {
      contextRead.mockRestore()
    }
  })
  test('definition-only saves preserve persisted server assignments', async () => {
    const fixture = await createProjectFixture()
    const input = {
      userId: fixture.ownerId,
      teamSlug: fixture.teamSlug,
      projectName: fixture.projectName,
    }
    const context = await getProjectContext(input)
    const definitions = context.environments.map(
      ({
        serverId: _serverId,
        effectiveServerId: _effectiveServerId,
        ...environment
      }) => ({ ...environment, branch: 'release/*' }),
    )
    const updated = await updateProjectEnvironments({
      ...input,
      projectEnvironments: definitions,
    })
    expect(updated.environments[0]?.serverId).toBe(fixture.serverId)
    expect(updated.environments[0]?.branch).toBe('release/*')
  })

  test('variable scopes preserve shared overrides and reject unknown environments without changing stored values', async () => {
    const fixture = await createProjectFixture()
    const input = {
      userId: fixture.ownerId,
      teamSlug: fixture.teamSlug,
      projectName: fixture.projectName,
    }
    const envVars = [
      { key: 'TOKEN', value: 'shared', environment: '' },
      { key: 'TOKEN', value: 'scoped', environment: fixture.environmentId },
    ]
    const saved = await updateProjectEnvVars({ ...input, envVars })
    expect(saved.envVars).toEqual(envVars)
    await expect(
      updateProjectEnvVars({
        ...input,
        envVars: [
          { key: 'TOKEN', value: 'replacement', environment: 'missing' },
        ],
      }),
    ).rejects.toThrow('Select a valid environment')
    await expect(
      updateProjectEnvVars({ ...input, envVars: [envVars[0]!, envVars[0]!] }),
    ).rejects.toThrow('unique per environment')
    const context = await getProjectContext({ ...input, scope: 'settings' })
    expect(context.envVars).toEqual(envVars)
    const section = await getProjectSectionContext({
      ...input,
      scope: 'settings',
    })
    expect(section.scope === 'settings' && section.envVars).toEqual(envVars)
  })

  test('policies can reuse workspace storage and reject other workspaces without replacing saved policies', async () => {
    const fixture = await createProjectFixture()
    const otherTeamId = makeId('other-team')
    touchedTeamIds.push(otherTeamId)
    const other = { ownerId: fixture.ownerId, teamSlug: makeSlug(otherTeamId) }
    await db.insert(teams).values({
      id: otherTeamId,
      name: 'Other workspace',
      slug: other.teamSlug,
    })
    await db.insert(teamMembers).values({
      id: makeId('member'),
      teamId: otherTeamId,
      userId: fixture.ownerId,
      role: 'owner',
    })
    const input = {
      name: 'Shared',
      bucket: 'shared-bucket',
      region: 'auto',
      endpoint: '',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    }
    const localStorage = (
      await saveBackupStorage({
        userId: fixture.adminId,
        teamSlug: fixture.teamSlug,
        input,
      })
    )[0]!
    const foreignStorage = (
      await saveBackupStorage({
        userId: other.ownerId,
        teamSlug: other.teamSlug,
        input,
      })
    )[0]!
    const policy = {
      id: makeId('backup-policy'),
      name: 'Nightly',
      environmentId: fixture.environmentId,
      enabled: true,
      schedule: { cron: '0 2 * * *' },
      destination: { storageId: localStorage.id },
      retention: {
        local: { count: 7, days: 0, maxStorageGb: 0 },
        remote: { enabled: true, count: 7, days: 0, maxStorageGb: 0 },
      },
      volumes: { mode: 'none' as const, names: [] },
      databaseDumps: [],
    }
    const route = {
      settingsVersion: null,
      userId: fixture.adminId,
      teamSlug: fixture.teamSlug,
      projectName: fixture.projectName,
    }
    const saved = await saveProjectBackupPolicy({
      ...route,
      policy,
    })
    expect(saved.backupConfigs[0]?.settingsVersion).toBe(1)
    expect(saved.backupConfigs[0]?.destination).toEqual({
      storageId: localStorage.id,
      prefix: `projects/${fixture.projectId}/environments/${fixture.environmentId}/backups/${policy.id}`,
    })
    expect(JSON.stringify(saved)).not.toContain('secretAccessKey')
    await expect(
      saveProjectBackupPolicy({
        ...route,
        settingsVersion: 1,
        policy: { ...policy, destination: { storageId: foreignStorage.id } },
      }),
    ).rejects.toThrow('in this workspace')
    await expect(
      saveProjectBackupPolicy({
        ...route,
        userId: fixture.memberId,
        policy,
      }),
    ).rejects.toThrow('Only team owners and admins')
    await expect(
      createManualBackupRun({
        ...route,
        userId: fixture.memberId,
        backupConfigId: policy.id,
      }),
    ).rejects.toThrow('Only team owners and admins')
    const preserved = (
      await db
        .select()
        .from(backupConfigs)
        .where(eq(backupConfigs.id, policy.id))
    )[0]!
    expect(preserved.destination).toEqual(saved.backupConfigs[0]?.destination)
  })

  test('updates only the selected policy and preserves its creation time', async () => {
    const { ownerId, teamSlug, projectName, projectId, environmentId } =
      await createProjectFixture()
    const configs = Array.from({ length: 20 }, (_, index) => ({
      id: makeId('backup-config'),
      name: `Policy ${index}`,
      environmentId,
      enabled: true,
      schedule: { cron: '0 0 * * *' },
      destination: { prefix: 'project-backups' },
      retention: {
        local: { count: 7, days: 0, maxStorageGb: 0 },
        remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
      },
      volumes: { mode: 'allNamed' as const, names: [] },
      databaseDumps: [],
    }))
    const input = { userId: ownerId, teamSlug, projectName }
    for (const policy of configs)
      await saveProjectBackupPolicy({ ...input, settingsVersion: null, policy })
    const [first] = await db
      .select()
      .from(backupConfigs)
      .where(eq(backupConfigs.id, configs[0]!.id))
    const changed = await saveProjectBackupPolicy({
      ...input,
      settingsVersion: 1,
      policy: { ...configs[0]!, name: 'Updated' },
    })
    expect(changed.backupConfigs).toHaveLength(20)
    const [saved] = await db
      .select()
      .from(backupConfigs)
      .where(eq(backupConfigs.id, configs[0]!.id))
    expect(saved!.createdAt).toEqual(first!.createdAt)
    expect(saved!.settingsVersion).toBe(2)
    await expect(
      saveProjectBackupPolicy({
        ...input,
        settingsVersion: 1,
        policy: configs[0]!,
      }),
    ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    await deleteProjectBackupPolicy({
      ...input,
      settingsVersion: 2,
      policyId: configs[0]!.id,
    })
    expect(
      await db
        .select()
        .from(backupConfigs)
        .where(eq(backupConfigs.projectId, projectId)),
    ).toHaveLength(19)
  })

  test('custom domains reject environments from another project', async () => {
    const target = await createProjectFixture()
    const foreignProjectId = makeId('project')
    const foreignEnvironmentId = makeId('environment')
    touchedProjectIds.push(foreignProjectId)
    touchedEnvironmentIds.push(foreignEnvironmentId)
    await db.insert(projects).values({
      id: foreignProjectId,
      githubRepo: 'example/foreign-project',
      name: makeSlug(foreignProjectId),
      slug: makeSlug(foreignProjectId),
      teamId: target.teamId,
    })
    await db.insert(environments).values({
      id: foreignEnvironmentId,
      branch: 'main',
      isProduction: true,
      name: 'Production',
      projectId: foreignProjectId,
      runtimeId: makeId('runtime'),
      serverId: target.serverId,
      slug: 'production',
    })

    await expect(
      updateProjectDomains({
        userId: target.ownerId,
        teamSlug: target.teamSlug,
        projectName: target.projectName,
        domains: [
          {
            host: `${makeSlug(makeId('domain'))}.example.com`,
            environmentId: foreignEnvironmentId,
            basePath: null,
            https: true,
          },
        ],
      }),
    ).rejects.toThrow('Select a valid environment for every domain.')
  })

  test('project and deployment contexts reject users from another tenant', async () => {
    const target = await createProjectFixture()
    const outsiderId = makeId('user')
    const outsiderTeamId = makeId('team')
    touchedUserIds.push(outsiderId)
    touchedTeamIds.push(outsiderTeamId)
    await db.insert(user).values(makeUser(outsiderId))
    await db.insert(teams).values({
      id: outsiderTeamId,
      name: 'Outside integration team',
      slug: makeSlug(outsiderTeamId),
    })
    await db.insert(teamMembers).values({
      id: makeId('member'),
      role: 'owner',
      teamId: outsiderTeamId,
      userId: outsiderId,
    })

    await expect(
      getProjectContext({
        userId: outsiderId,
        teamSlug: target.teamSlug,
        projectName: target.projectName,
        scope: 'shell',
      }),
    ).rejects.toThrow('Project not found.')

    for (const scope of [
      'overview',
      'deployments',
      'settings',
      'backups',
    ] as const) {
      await expect(
        getProjectSectionContext({
          userId: outsiderId,
          teamSlug: target.teamSlug,
          projectName: target.projectName,
          scope,
        }),
      ).rejects.toThrow('Project not found.')
    }

    await expect(
      getDeploymentSectionContext({
        userId: outsiderId,
        teamSlug: target.teamSlug,
        projectName: target.projectName,
        deploymentId: target.runningDeploymentId,
      }),
    ).rejects.toThrow('Project not found.')
    await expect(
      getDeploymentLogsContext({
        userId: outsiderId,
        teamSlug: target.teamSlug,
        projectName: target.projectName,
        deploymentId: target.runningDeploymentId,
      }),
    ).rejects.toThrow('Deployment not found.')
  })

  test('section contexts preserve the full-context data contract', async () => {
    const { ownerId, projectId, projectName, teamSlug } =
      await createProjectFixture()
    await db
      .update(projects)
      .set({ composeMetadata: { services: [], volumes: [], warnings: [] } })
      .where(eq(projects.id, projectId))
    const full = await getProjectContext({
      userId: ownerId,
      teamSlug,
      projectName,
      scope: 'full',
    })

    const [overview, deploymentsSection, settings, backups] = await Promise.all(
      [
        getProjectSectionContext({
          userId: ownerId,
          teamSlug,
          projectName,
          scope: 'overview',
        }),
        getProjectSectionContext({
          userId: ownerId,
          teamSlug,
          projectName,
          scope: 'deployments',
        }),
        getProjectSectionContext({
          userId: ownerId,
          teamSlug,
          projectName,
          scope: 'settings',
        }),
        getProjectSectionContext({
          userId: ownerId,
          teamSlug,
          projectName,
          scope: 'backups',
        }),
      ],
    )

    expect(overview.scope).toBe('overview')
    expect(deploymentsSection.scope).toBe('deployments')
    expect(settings.scope).toBe('settings')
    expect(backups.scope).toBe('backups')
    if (
      overview.scope !== 'overview' ||
      deploymentsSection.scope !== 'deployments' ||
      settings.scope !== 'settings' ||
      backups.scope !== 'backups'
    ) {
      throw new Error('Project section context returned the wrong scope.')
    }

    expect(overview.projectId).toBe(full.project.id)
    expect(overview.deployments).toEqual(full.deployments)
    expect(overview.runtime).toEqual(full.environment.runtime)
    expect(deploymentsSection.deployments).toEqual(full.deployments)
    expect(settings).toMatchObject({
      projectId: full.project.id,
      composeMetadata: full.composeMetadata,
      domains: full.domains,
      envVars: full.envVars,
    })
    expect(full.composeMetadata).toEqual({
      services: [],
      volumes: [],
      warnings: [],
    })
    expect(backups).toMatchObject({
      projectId: full.project.id,
      backupConfigs: full.backupConfigs,
      backupRuns: full.backupRuns,
      composeMetadata: full.composeMetadata,
    })
  })

  test('backup section maps stored artifacts onto their run', async () => {
    const {
      environmentId,
      ownerId,
      projectId,
      projectName,
      serverId,
      teamSlug,
    } = await createProjectFixture()
    const backupRunId = makeId('backup-run')
    const artifactId = makeId('backup-artifact')
    touchedBackupRunIds.push(backupRunId)

    await db.insert(backupRuns).values({
      id: backupRunId,
      projectId,
      environmentId,
      serverId,
      runtimeId: 'runtime-production',
      status: 'succeeded',
    })
    await db.insert(backupArtifacts).values({
      id: artifactId,
      backupRunId,
      type: 'manifest',
      storage: 'remote',
      objectKey: 'backups/test/manifest.json',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 42,
    })

    const section = await getProjectSectionContext({
      userId: ownerId,
      teamSlug,
      projectName,
      scope: 'backups',
    })

    if (section.scope !== 'backups') {
      throw new Error('Project section context returned the wrong scope.')
    }

    expect(
      section.backupRuns.find((run) => run.id === backupRunId)?.artifacts,
    ).toEqual([
      expect.objectContaining({
        id: artifactId,
        objectKey: 'backups/test/manifest.json',
        sizeBytes: 42,
      }),
    ])
  })

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

  test('competing environment updates reconcile the same slug to one persisted ID', async () => {
    const fixture = await createProjectFixture()
    const production = {
      id: fixture.environmentId,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      color: 'blue',
      position: 0,
      status: 'active' as const,
      effectiveServerId: fixture.serverId,
      serverId: fixture.serverId,
    }
    const stagingIds = [makeId('environment'), makeId('environment')]
    touchedEnvironmentIds.push(...stagingIds)
    const results = await Promise.allSettled(
      stagingIds.map((id) =>
        updateProjectEnvironments({
          userId: fixture.ownerId,
          teamSlug: fixture.teamSlug,
          projectName: fixture.projectName,
          projectEnvironments: [
            production,
            {
              ...production,
              id,
              name: 'Staging',
              slug: 'staging',
              branch: 'staging-*',
              position: 1,
            },
          ],
        }),
      ),
    )
    const rows = await db
      .select()
      .from(environments)
      .where(eq(environments.projectId, fixture.projectId))
    const staging = rows.filter((e) => e.slug === 'staging')
    expect(staging).toHaveLength(1)
    expect(required(rows.filter((e) => e.slug === 'production')[0]).id).toBe(
      fixture.environmentId,
    )
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'SETTINGS_CONFLICT' } })
    for (const settled of results) {
      if (settled.status !== 'fulfilled') continue
      const result = settled.value
      const aliasRows = await db
        .select()
        .from(aliases)
        .where(eq(aliases.environmentId, required(staging[0]).id))
      for (const alias of aliasRows)
        if (!touchedHostnameIds.includes(alias.id))
          touchedHostnameIds.push(alias.id)
      expect(aliasRows.filter((a) => a.type === 'environment')).toHaveLength(1)
      expect(result.environments.some((e) => e.slug === 'staging')).toBe(true)
    }
    const allAliases = await db
      .select()
      .from(aliases)
      .where(eq(aliases.projectId, fixture.projectId))
    for (const alias of allAliases)
      if (!touchedHostnameIds.includes(alias.id))
        touchedHostnameIds.push(alias.id)
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

  test('managed hostname collisions retain the namespace within DNS limits', async () => {
    const { environmentId, projectId } = await createProjectFixture()
    const domainId = makeId('domain')
    const suffix = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`
    const hostname = `${'a'.repeat(63)}.${suffix}`
    touchedDomainIds.push(domainId)
    await db
      .insert(domains)
      .values({ id: domainId, environmentId, projectId, hostname })
    const resolved = await resolveAvailableAliasHostname({
      hostname,
      uniquenessKey: projectId,
    })
    expect(resolved).not.toBe(hostname)
    expect(resolved.endsWith(`.${suffix}`)).toBe(true)
    expect(resolved.length).toBeLessThanOrEqual(253)
    expect(resolved.split('.').every((label) => label.length <= 63)).toBe(true)
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

  test('concurrent project renames cannot take the same name', async () => {
    const { ownerId, projectName, teamId, teamSlug } =
      await createProjectFixture()
    const secondId = makeId('project')
    const secondName = makeSlug(secondId)
    const secondEnvironmentId = makeId('environment')
    touchedProjectIds.push(secondId)
    touchedEnvironmentIds.push(secondEnvironmentId)
    await db.insert(projects).values({
      id: secondId,
      name: secondName,
      slug: secondName,
      teamId,
      githubRepo: 'example/project',
      runtimeConfig: createComposeRuntimeConfig({
        path: 'compose.current.yml',
      }),
    })
    await db.insert(environments).values({
      id: secondEnvironmentId,
      projectId: secondId,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      isProduction: true,
      runtimeId: makeId('runtime'),
    })
    const desiredName = `renamed-${crypto.randomUUID()}`
    const results = await Promise.allSettled(
      [projectName, secondName].map((currentProjectName) =>
        updateProjectSettings({
          userId: ownerId,
          teamSlug,
          currentProjectName,
          projectName: desiredName,
          repoFullName: 'example/project',
          installationId: null,
          runtimeConfig: createComposeRuntimeConfig({
            path: 'compose.current.yml',
          }),
        }),
      ),
    )
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const renamed = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, desiredName))
    expect(renamed).toHaveLength(1)
    const failed = results.find((result) => result.status === 'rejected')
    expect(failed?.status === 'rejected' ? failed.reason.message : '').toBe(
      'Project names must be unique within a team.',
    )
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

  test('only owners and admins can change host lifecycle commands', async () => {
    const { adminId, memberId, projectName, teamSlug } =
      await createProjectFixture()

    const memberRuntimeConfigs = [
      createComposeRuntimeConfig({
        path: 'compose.current.yml',
        readinessPath: '/current-health',
        releaseCommand: 'current-release',
        deployCommand: './scripts/deploy',
      }),
      createComposeRuntimeConfig({
        path: 'compose.current.yml',
        readinessPath: '/current-health',
        releaseCommand: 'current-release',
        rollbackCommand: './scripts/rollback',
      }),
    ]

    for (const runtimeConfig of memberRuntimeConfigs) {
      await expect(
        updateProjectSettings({
          userId: memberId,
          teamSlug,
          currentProjectName: projectName,
          projectName,
          repoFullName: 'example/project',
          installationId: null,
          runtimeConfig,
        }),
      ).rejects.toThrow(
        'Only team owners and admins can change host lifecycle commands.',
      )
    }

    await expect(
      updateProjectSettings({
        userId: adminId,
        teamSlug,
        currentProjectName: projectName,
        projectName,
        repoFullName: 'example/project',
        installationId: null,
        runtimeConfig: createComposeRuntimeConfig({
          path: 'compose.current.yml',
          readinessPath: '/current-health',
          releaseCommand: 'current-release',
          releaseService: 'worker',
          deployCommand: './scripts/deploy',
          rollbackCommand: './scripts/rollback',
        }),
      }),
    ).resolves.toMatchObject({
      project: {
        runtimeConfig: {
          deployCommand: './scripts/deploy',
          releaseService: 'worker',
          rollbackCommand: './scripts/rollback',
        },
      },
    })
  })

  test('members cannot repoint configured host lifecycle commands', async () => {
    const { adminId, memberId, projectName, teamSlug } =
      await createProjectFixture()
    const hostRuntimeConfig = createComposeRuntimeConfig({
      path: 'compose.current.yml',
      readinessPath: '/current-health',
      releaseCommand: 'current-release',
      deployCommand: './scripts/deploy',
    })

    await updateProjectSettings({
      userId: adminId,
      teamSlug,
      currentProjectName: projectName,
      projectName,
      repoFullName: 'example/project',
      installationId: null,
      runtimeConfig: hostRuntimeConfig,
    })

    await expect(
      updateProjectSettings({
        userId: memberId,
        teamSlug,
        currentProjectName: projectName,
        projectName,
        repoFullName: 'example/project',
        installationId: null,
        runtimeConfig: {
          ...hostRuntimeConfig,
          path: 'compose.member.yml',
        },
      }),
    ).rejects.toThrow(
      'Only team owners and admins can change the source of host lifecycle commands.',
    )
  })

  test('project settings updates return settings-scoped data', async () => {
    const { environmentId, ownerId, projectId, projectName, teamSlug } =
      await createProjectFixture()
    const domainId = makeId('domain')
    touchedDomainIds.push(domainId)
    await db.insert(domains).values({
      id: domainId,
      environmentId,
      hostname: `${makeSlug(domainId)}.example.com`,
      projectId,
    })

    const result = await updateProjectSettings({
      userId: ownerId,
      teamSlug,
      currentProjectName: projectName,
      projectName,
      repoFullName: 'example/project',
      installationId: null,
      runtimeConfig: createComposeRuntimeConfig({
        path: 'compose.current.yml',
        readinessPath: '/current-health',
        releaseCommand: 'current-release',
      }),
    })

    expect(result.domains).toEqual([
      expect.objectContaining({ id: domainId, environmentId }),
    ])
  })

  test('members can change container-scoped pre-deploy commands', async () => {
    const { memberId, projectName, teamSlug } = await createProjectFixture()

    await expect(
      updateProjectSettings({
        userId: memberId,
        teamSlug,
        currentProjectName: projectName,
        projectName,
        repoFullName: 'example/project',
        installationId: null,
        runtimeConfig: createComposeRuntimeConfig({
          path: 'compose.current.yml',
          readinessPath: '/current-health',
          releaseCommand: 'changed-release',
          releaseService: 'worker',
        }),
      }),
    ).resolves.toMatchObject({
      project: {
        runtimeConfig: {
          releaseCommand: 'changed-release',
          releaseService: 'worker',
        },
      },
    })
  })

  test('members cannot configure backups or restore data', async () => {
    const { memberId, projectName, teamSlug } = await createProjectFixture()

    await expect(
      deleteProjectBackupPolicy({
        settingsVersion: 1,
        policyId: 'unavailable',
        projectName,
        teamSlug,
        userId: memberId,
      }),
    ).rejects.toThrow(
      'Only team owners and admins can configure backups or restore data.',
    )

    await expect(
      createBackupRestoreJob({
        artifacts: [],
        backupRunId: 'backup-run',
        projectName,
        teamSlug,
        userId: memberId,
      }),
    ).rejects.toThrow(
      'Only team owners and admins can configure backups or restore data.',
    )
  })

  test('members read scoped restore status without job payloads or credentials', async () => {
    const fixture = await createProjectFixture()
    const otherProjectId = makeId('other-project')
    touchedProjectIds.push(otherProjectId)
    const project = (
      await db.select().from(projects).where(eq(projects.id, fixture.projectId))
    )[0]!
    await db
      .insert(projects)
      .values({ ...project, id: otherProjectId, slug: 'other-project' })
    const jobIds = [
      makeId('restore'),
      makeId('other-restore'),
      makeId('backup'),
    ]
    touchedJobIds.push(...jobIds)
    await db.insert(agentJobs).values(
      jobIds.map((id, index) => ({
        id,
        type: index === 2 ? ('backup' as const) : ('restore' as const),
        status: 'abandoned' as const,
        serverId: fixture.serverId,
        projectId: index === 1 ? otherProjectId : fixture.projectId,
        payload: {
          backupRunId: 'run',
          environmentId: fixture.environmentId,
          destination: { secretAccessKey: 'never-public' },
        },
        errorMessage: 'Restore interrupted.',
      })),
    )
    const context = await getProjectContext({
      userId: fixture.memberId,
      teamSlug: fixture.teamSlug,
      projectName: fixture.projectName,
      scope: 'backups',
    })
    expect(context.backupRestores).toHaveLength(1)
    expect(context.backupRestores[0]).toMatchObject({
      id: jobIds[0],
      status: 'failed',
      errorMessage: 'Restore interrupted.',
    })
    expect(JSON.stringify(context.backupRestores)).not.toContain('never-public')
    expect(context.backupRestores[0]).not.toHaveProperty('payload')
  })

  test('members can update ordinary settings without changing lifecycle commands', async () => {
    const { memberId, projectName, teamSlug } = await createProjectFixture()

    await expect(
      updateProjectSettings({
        userId: memberId,
        teamSlug,
        currentProjectName: projectName,
        projectName,
        repoFullName: 'example/project',
        installationId: null,
        runtimeConfig: createComposeRuntimeConfig({
          path: 'compose.current.yml',
          readinessPath: '/updated-health',
          releaseCommand: 'current-release',
        }),
      }),
    ).resolves.toMatchObject({
      project: { runtimeConfig: { readinessPath: '/updated-health' } },
    })
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
      environmentId,
      ownerId,
      projectId,
      projectName,
      runningDeploymentId,
      queuedDeploymentId,
      succeededDeploymentId,
      serverId,
      teamSlug,
    } = await createProjectFixture()
    const backupRunId = makeId('backup-run')
    const backupJobId = makeId('backup-job')
    touchedBackupRunIds.push(backupRunId)
    touchedJobIds.push(backupJobId)
    await db.insert(backupRuns).values({
      id: backupRunId,
      projectId,
      environmentId,
      serverId,
      runtimeId: 'runtime-production',
      status: 'running',
    })
    await db.insert(agentJobs).values({
      id: backupJobId,
      type: 'backup',
      status: 'running',
      serverId,
      projectId,
      payload: { schemaVersion: 1, backupRunId },
    })
    const inheritedEnvironmentId = makeId('environment')
    touchedEnvironmentIds.push(inheritedEnvironmentId)
    await db
      .update(projects)
      .set({ defaultServerId: serverId })
      .where(eq(projects.id, projectId))
    await db.insert(environments).values({
      id: inheritedEnvironmentId,
      branch: 'preview/*',
      isProduction: false,
      name: 'Preview',
      projectId,
      runtimeId: 'runtime-inherited-unused',
      serverId: null,
      slug: 'preview',
    })

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
    const environmentRows = await db
      .select({ status: environments.status })
      .from(environments)
      .where(eq(environments.projectId, projectId))
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
    const backupRunRows = await db
      .select({
        status: backupRuns.status,
        errorMessage: backupRuns.errorMessage,
      })
      .from(backupRuns)
      .where(eq(backupRuns.id, backupRunId))
    touchedJobIds.push(...jobRows.map((row) => row.id))

    const deploymentById = new Map(
      deploymentRows.map((deployment) => [deployment.id, deployment]),
    )
    const queuedDeployment = deploymentById.get(queuedDeploymentId)
    const runningDeployment = deploymentById.get(runningDeploymentId)
    const succeededDeployment = deploymentById.get(succeededDeploymentId)

    expect(projectRows).toEqual([{ status: 'deleted' }])
    expect(environmentRows).toEqual([
      { status: 'deleted' },
      { status: 'deleted' },
    ])
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
    expect(hostnameRows.length).toBeGreaterThan(0)
    await pruneDeletedResources()
    expect(
      await db.select().from(aliases).where(eq(aliases.projectId, projectId)),
    ).toHaveLength(hostnameRows.length)
    await db
      .update(agentJobs)
      .set({ status: 'succeeded' })
      .where(
        eq(agentJobs.id, jobRows.find((job) => job.type === 'deprovision')!.id),
      )
    await pruneDeletedResources()
    expect(
      await db.select().from(aliases).where(eq(aliases.projectId, projectId)),
    ).toEqual([])
    expect(jobRows).toHaveLength(3)
    expect(jobRows.find((job) => job.id === backupJobId)).toMatchObject({
      type: 'backup',
      status: 'canceled',
    })
    expect(backupRunRows).toEqual([
      {
        status: 'canceled',
        errorMessage: 'Canceled because the project was deleted.',
      },
    ])
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
        'runtime-inherited-unused',
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
        'runtime-inherited-unused',
      ]),
    })
    expect(purgeJob?.availableAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('deleting a project can leave deployed runtimes intact', async () => {
    const {
      ownerId,
      projectId,
      projectName,
      environmentId,
      runningDeploymentId,
      queuedDeploymentId,
      teamSlug,
    } = await createProjectFixture()

    const reservedHostname = `${projectName}-127-0-0-1.nip.io`
    const domainId = makeId('retained-domain')
    touchedDomainIds.push(domainId)
    await db.insert(domains).values({
      id: domainId,
      projectId,
      environmentId,
      hostname: reservedHostname,
    })

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
    const environmentRows = await db
      .select({ status: environments.status })
      .from(environments)
      .where(eq(environments.projectId, projectId))
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
    expect(environmentRows).toEqual([{ status: 'active' }])
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
    expect(
      await db.select().from(aliases).where(eq(aliases.projectId, projectId)),
    ).toHaveLength(1)
    expect(
      await db.select().from(domains).where(eq(domains.projectId, projectId)),
    ).toHaveLength(1)
    expect(
      await resolveAvailableAliasHostname({
        hostname: reservedHostname,
        uniquenessKey: 'replacement-project',
      }),
    ).not.toBe(reservedHostname)
  })

  test.each([createRollbackDeployment, createRedeployDeployment])(
    'historical replay rejects a moved environment',
    async (replay) => {
      const f = await createProjectFixture()
      await db
        .update(environments)
        .set({ serverId: null })
        .where(eq(environments.id, f.environmentId))
      await expect(
        replay({
          deploymentId: f.succeededDeploymentId,
          userId: f.ownerId,
          teamSlug: f.teamSlug,
          projectName: f.projectName,
        }),
      ).rejects.toMatchObject({ code: 'DEPLOYMENT_SERVER_CHANGED' })
    },
  )

  test('rollback reuses the source deployment config and env vars', async () => {
    const { ownerId, projectId, projectName, succeededDeploymentId, teamSlug } =
      await createProjectFixture()
    await db
      .update(projects)
      .set({
        routes: [{ path: '/', service: 'web', port: 3000, stripPrefix: false }],
      })
      .where(eq(projects.id, projectId))

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
    expect(
      deploymentConfig?.routes.some(
        (route) => route.host === 'old.example.devpush.app',
      ),
    ).toBe(false)
    expect(
      deploymentConfig?.routes.some(
        (route) => route.host === `${projectName}.example.devpush.app`,
      ),
    ).toBe(true)
    expect(hostnameRows.at(0)?.hostname).toMatch(
      new RegExp(`^${rollback.deploymentId.slice(0, 7)}-`),
    )
    const context = await getDeploymentSectionContext({
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
    const { ownerId, projectId, projectName, succeededDeploymentId, teamSlug } =
      await createProjectFixture()
    await db
      .update(projects)
      .set({
        routes: [{ path: '/', service: 'web', port: 3000, stripPrefix: false }],
      })
      .where(eq(projects.id, projectId))

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
    expect(
      deploymentConfig?.routes.some(
        (route) => route.host === 'old.example.devpush.app',
      ),
    ).toBe(false)
    expect(
      deploymentConfig?.routes.some(
        (route) => route.host === `${projectName}.example.devpush.app`,
      ),
    ).toBe(true)
    expect(hostnameRows.at(0)?.hostname).toMatch(
      new RegExp(`^${redeploy.deploymentId.slice(0, 7)}-`),
    )
  })

  test('a hostname failure records a failed push and does not prevent other projects from deploying', async () => {
    const first = await createProjectFixture()
    await db
      .update(deployments)
      .set({ runtimeId: sql`${deployments.runtimeId} || ${deployments.id}` })
      .where(eq(deployments.environmentId, first.environmentId))
    const fixtures = [first, await createProjectFixture()]
    const installationId = 456788
    touchedInstallationIds.push(installationId)
    await db.insert(githubInstallations).values({
      installationId,
      accountLogin: 'example',
      accountType: 'Organization',
      repositorySelection: 'selected',
    })
    for (const f of fixtures)
      await db
        .update(projects)
        .set({ githubInstallationId: installationId, githubRepoId: 123 })
        .where(eq(projects.id, f.projectId))
    vi.spyOn(
      GeneratedHostnameModule,
      'resolveGeneratedHostname',
    ).mockRejectedValueOnce(new Error('certificate pending'))
    const deliveryId = crypto.randomUUID()
    const result = await createDeploymentsForGitHubPush({
      deliveryId,
      installationId,
      repositoryId: 123,
      repositoryFullName: 'example/project',
      branch: 'main',
      gitSha: 'abc123',
      message: 'Fan out',
    })
    const rows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.githubDeliveryId, deliveryId))
    touchedDeploymentIds.push(...rows.map((row) => row.id))
    expect(result.created).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(rows.map((row) => row.status).sort()).toEqual(['failed', 'queued'])
  })

  test.each(['server_disconnected', 'agent_update_required'] as const)(
    'records skipped push %s without canceling existing deployments',
    async (reason) => {
      const { projectId, environmentId, serverId, runningDeploymentId } =
        await createProjectFixture()
      const installationId = 456789
      touchedInstallationIds.push(installationId)
      await db.insert(githubInstallations).values({
        installationId,
        accountLogin: 'example',
        accountType: 'Organization',
        repositorySelection: 'selected',
      })
      await db
        .update(projects)
        .set({ githubInstallationId: installationId, githubRepoId: 123 })
        .where(eq(projects.id, projectId))
      await db
        .update(servers)
        .set(
          reason === 'server_disconnected'
            ? { status: 'disconnected' }
            : { agentCapabilities: [] },
        )
        .where(eq(servers.id, serverId))
      const beforeAliases = await db
        .select()
        .from(aliases)
        .where(eq(aliases.projectId, projectId))
      const push = {
        deliveryId: crypto.randomUUID(),
        installationId,
        repositoryId: 123,
        repositoryFullName: 'example/project',
        branch: 'main',
        gitSha: 'abc123',
        message: 'Blocked push',
      }
      const result = await createDeploymentsForGitHubPush(push)
      expect(result).toMatchObject({
        created: [],
        skipped: [{ projectId, environmentId, reason }],
      })
      const rows = await db
        .select()
        .from(deployments)
        .where(eq(deployments.githubDeliveryId, push.deliveryId))
      touchedDeploymentIds.push(...rows.map((row) => row.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        status: 'failed',
        phase: 'failed',
        trigger: 'webhook',
      })
      expect(rows[0]?.errorMessage).toContain(
        reason === 'server_disconnected'
          ? 'disconnected'
          : 'requires an update',
      )
      expect(
        await db
          .select()
          .from(deploymentEvents)
          .where(eq(deploymentEvents.deploymentId, rows[0]!.id)),
      ).toEqual([])
      expect(
        (
          await db
            .select()
            .from(deployments)
            .where(eq(deployments.id, runningDeploymentId))
        )[0]?.status,
      ).toBe('running')
      expect(
        await db.select().from(aliases).where(eq(aliases.projectId, projectId)),
      ).toEqual(beforeAliases)
      expect(await createDeploymentsForGitHubPush(push)).toMatchObject({
        created: [],
        skipped: [{ reason: 'duplicate_delivery' }],
      })
    },
  )

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
    const deliveryId = crypto.randomUUID()
    const push = {
      deliveryId,
      installationId,
      repositoryId: repoId,
      repositoryFullName: 'example/renamed-project',
      branch: 'main',
      gitSha: 'abcdef123456',
      message: 'Push deployment',
      authorName: 'Ada',
      authoredAt: '2026-10-12T01:00:00Z',
      commitUrl:
        'https://github.com/example/renamed-project/commit/abcdef123456',
    }
    const result = await createDeploymentsForGitHubPush(push)
    const deploymentId = result.created.at(0)?.deploymentId

    if (!deploymentId) {
      throw new Error(`Deployment was not created: ${JSON.stringify(result)}`)
    }

    touchedDeploymentIds.push(deploymentId)

    const [beforeRepeat] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
    await expect(createDeploymentsForGitHubPush(push)).resolves.toMatchObject({
      created: [],
      skipped: [{ projectId, environmentId, reason: 'duplicate_delivery' }],
    })

    const [afterRepeat] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
    expect(afterRepeat?.updatedAt).toEqual(beforeRepeat?.updatedAt)
    expect(afterRepeat?.settingsVersion).toBe(beforeRepeat?.settingsVersion)

    const rows = await db
      .select({ deployment: deployments })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
    const snapshot = parseDeploymentConfig(rows.at(0)?.deployment.config)

    expect(
      (await db.select().from(projects).where(eq(projects.id, projectId)))[0]
        ?.githubRepo,
    ).toBe('example/renamed-project')
    expect(rows.at(0)?.deployment).toMatchObject({
      serverId,
      runtimeId: 'runtime-production',
      trigger: 'webhook',
      repoFullName: 'example/renamed-project',
      commitMeta: {
        message: push.message,
        authorName: push.authorName,
        authoredAt: push.authoredAt,
        url: push.commitUrl,
      },
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
      deployCommand: './scripts/deploy',
      rollbackCommand: './scripts/rollback',
      timeoutSeconds: 900,
    })

    const concurrent = await Promise.all(
      ['concurrent-a', 'concurrent-b'].map((gitSha) =>
        createDeploymentsForGitHubPush({
          ...push,
          deliveryId: crypto.randomUUID(),
          gitSha,
        }),
      ),
    )
    const concurrentIds = concurrent.flatMap((item) =>
      item.created.map((created) => created.deploymentId),
    )
    touchedDeploymentIds.push(...concurrentIds)
    expect(concurrentIds).toHaveLength(2)

    const environmentDeployments = await db
      .select({ status: deployments.status })
      .from(deployments)
      .where(eq(deployments.environmentId, environmentId))
    expect(
      environmentDeployments.filter((item) => item.status === 'queued'),
    ).toHaveLength(1)
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
        envVarsEncrypted: encryptProjectEnvVars([
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
        ]),
      })
      .where(eq(projects.id, projectId))

    const result = await createDeploymentsForGitHubPush({
      deliveryId: crypto.randomUUID(),
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
      deliveryId: crypto.randomUUID(),
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

  if (touchedBackupRunIds.length > 0) {
    await db
      .delete(backupRuns)
      .where(inArray(backupRuns.id, touchedBackupRunIds))
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
  touchedBackupRunIds.length = 0
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
