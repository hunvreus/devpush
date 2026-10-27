import { WorkspacePolicyError } from '#devpush/plugins/server'
import { saveProjectBackupPolicy } from '#devpush/server/projects/backups'
import { config as installationConfig } from '#devpush/server/config'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db, logsDb } from '#devpush/server/db'
import {
  apiAudit,
  apiIdempotency,
  apiKeys,
  agentJobs,
  backupArtifacts,
  backupConfigs,
  backupRuns,
  backupStorage,
  deployments,
  environments,
  projects,
  servers,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'
import { deploymentLogs } from '#devpush/server/db/log-schema'
import { currentAgentCapabilities } from '#devpush/server/agents/compatibility'
import { createComposeRuntimeConfig } from '#devpush/lib/project-runtime-config'
import {
  encryptProjectEnvVars,
  readProjectEnvVars,
} from '#devpush/server/projects/project-env-vars'
import { scopesForApiPreset } from '#devpush/lib/api-key-schema'
import type { ApiPrincipal } from './authorization'
import { executeApiOperation } from './operations'
import { updateProjectEnvVars } from '#devpush/server/projects/environments'
import type * as RepositoryModule from '#devpush/server/projects/repository'
import { fetchProjectComposeMetadata } from '#devpush/server/projects/repository'
import { updateProjectSettings } from '#devpush/server/projects/settings'
import { handlePublicApiRequest } from './handler'
import { hashApiSecret } from './credentials'

const workspacePolicy = vi.hoisted(() => ({
  run: vi.fn(async (_input: unknown, action: () => Promise<unknown>) =>
    action(),
  ),
}))
vi.mock('#devpush/server/plugins/services.server', () => ({
  getPluginServices: () => ({
    workspaceAccess: { run: workspacePolicy.run },
  }),
}))
vi.mock('#devpush/server/realtime/service', () => ({
  notifyProject: vi.fn(),
  notifyWorkspace: vi.fn(),
}))
vi.mock('#devpush/server/projects/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof RepositoryModule>()),
  fetchProjectComposeMetadata: vi.fn(async () => null),
}))
afterEach(() => vi.restoreAllMocks())
afterAll(closeDb)

async function fixture() {
  const userId = crypto.randomUUID(),
    teamId = crypto.randomUUID(),
    membershipId = crypto.randomUUID(),
    projectId = crypto.randomUUID(),
    serverId = crypto.randomUUID(),
    environmentId = crypto.randomUUID(),
    deploymentId = crypto.randomUUID(),
    credentialId = crypto.randomUUID()
  const now = new Date()
  const secret = `dp_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  await db
    .insert(teams)
    .values({ id: teamId, name: `API ${teamId}`, slug: `api-${teamId}` })
  await db.insert(user).values({
    id: userId,
    name: 'API owner',
    email: `${userId}@example.invalid`,
    username: `api-${userId}`,
    defaultTeamId: teamId,
    emailVerified: true,
  })
  await db
    .insert(teamMembers)
    .values({ id: membershipId, teamId, userId, role: 'owner' })
  await db.insert(servers).values({
    id: serverId,
    teamId,
    name: 'server',
    handle: 'server',
    status: 'connected',
    lastSeenAt: now,
    publicAddress: '203.0.113.10',
    agentVersion: '0.1.0',
    agentProtocolVersion: 1,
    agentCapabilities: [...currentAgentCapabilities],
  })
  await db.insert(projects).values({
    id: projectId,
    teamId,
    name: 'api-project',
    slug: 'api-project',
    githubRepo: 'owner/repo',
    githubRepoId: 123,
    defaultServerId: serverId,
    runtimeConfig: createComposeRuntimeConfig({ path: 'compose.yml' }),
    envVarsEncrypted: encryptProjectEnvVars([
      { key: 'KEEP', value: 'hidden' },
      { key: 'CHANGE', value: 'old' },
    ]),
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(environments).values({
    id: environmentId,
    projectId,
    name: 'Production',
    slug: 'production',
    branch: 'main',
    isProduction: true,
    runtimeId: `runtime-${environmentId}`,
  })
  await db.insert(deployments).values({
    id: deploymentId,
    environmentId,
    serverId,
    status: 'succeeded',
    phase: 'complete',
    trigger: 'user',
    repoId: 123,
    repoFullName: 'owner/repo',
    gitSha: 'a'.repeat(40),
    gitBranch: 'main',
    config: {
      schemaVersion: 1,
      runtime: createComposeRuntimeConfig({ path: 'compose.yml' }),
      routes: [],
    },
    envVars: 'encrypted-deployment-secret',
    runtimeId: `runtime-${environmentId}`,
    createdAt: now,
  })
  const scopes = scopesForApiPreset('manage', 'owner', true)
  await db.insert(apiKeys).values({
    id: credentialId,
    userId,
    teamId,
    membershipId,
    name: 'API integration',
    prefix: 'dp_test',
    keyHash: await hashApiSecret(secret),
    roleCeiling: 'owner',
    preset: 'manage',
    projectIds: null,
    scopes,
    expiresAt: new Date(now.getTime() + 60_000),
  })
  const principal: ApiPrincipal = {
    userId,
    teamId,
    membershipId,
    roleCeiling: 'owner',
    projectIds: null,
    scopes,
    credentialId,
  }
  const execute = (operationId: string, input: unknown) =>
    executeApiOperation({
      operationId,
      input,
      principal,
      requestId: crypto.randomUUID(),
    })
  return {
    principal,
    execute,
    userId,
    teamId,
    membershipId,
    projectId,
    serverId,
    environmentId,
    deploymentId,
    credentialId,
    settingsVersion: 1,
    secret,
  }
}

describe('public API operations integration', () => {
  test('REST server creation enforces workspace policy without admitting rejected effects', async () => {
    const f = await fixture()
    workspacePolicy.run.mockRejectedValueOnce(
      new WorkspacePolicyError('restricted'),
    )
    await expect(
      f.execute('create_server', {
        name: 'blocked-server',
        idempotencyKey: 'blocked-server',
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_RESTRICTED' })
    expect(workspacePolicy.run).toHaveBeenLastCalledWith(
      {
        teamId: f.teamId,
        operation: 'server.create',
        actor: { kind: 'user', userId: f.userId, roleCeiling: 'owner' },
      },
      expect.any(Function),
    )
    expect(
      await db.select().from(servers).where(eq(servers.teamId, f.teamId)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(apiIdempotency)
        .where(eq(apiIdempotency.credentialId, f.credentialId)),
    ).toHaveLength(0)
    await expect(
      f.execute('create_server', {
        name: 'blocked-server',
        idempotencyKey: 'blocked-server',
      }),
    ).resolves.toBeDefined()
    expect(
      await db.select().from(servers).where(eq(servers.teamId, f.teamId)),
    ).toHaveLength(2)
  })

  test('rename collisions report the project name conflict without admitting work', async () => {
    const f = await fixture()
    await db.insert(projects).values({
      id: crypto.randomUUID(),
      teamId: f.teamId,
      name: 'taken-project',
      slug: 'taken-project',
      githubRepo: 'owner/repo',
      runtimeConfig: createComposeRuntimeConfig({ path: 'compose.yml' }),
    })
    await expect(
      f.execute('rename_project', {
        projectId: f.projectId,
        name: 'taken-project',
        settingsVersion: f.settingsVersion,
        idempotencyKey: 'taken-name',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_NAME_CONFLICT' })
    expect(
      await db
        .select()
        .from(apiAudit)
        .where(eq(apiAudit.resourceId, f.projectId)),
    ).toHaveLength(0)
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, f.projectId))
    expect(project?.name).toBe('api-project')
  })
  test('browser settings writes invalidate versions used by subsequent API writes', async () => {
    const f = await fixture()
    const saved = await updateProjectEnvVars({
      userId: f.userId,
      teamSlug: `api-${f.teamId}`,
      projectName: 'api-project',
      settingsVersion: f.settingsVersion,
      envVars: [],
    })
    expect(saved.project.settingsVersion).toBe(f.settingsVersion + 1)
    await expect(
      f.execute('update_project_configuration', {
        projectId: f.projectId,
        settingsVersion: f.settingsVersion,
        runtimeConfig: createComposeRuntimeConfig({ path: 'compose.yml' }),
        routes: [],
        idempotencyKey: 'stale-after-browser-settings',
      }),
    ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  })
  test('HTTP endpoints authenticate bearer credentials independently of browser cookies and validate transport contracts', async () => {
    const f = await fixture()
    const base = `https://devpush.example/api/v1/projects/${f.projectId}`
    const cookieOnly = await handlePublicApiRequest(
      new Request(base, {
        headers: { cookie: 'better-auth.session_token=test' },
      }),
    )
    expect(cookieOnly.status).toBe(401)
    const response = await handlePublicApiRequest(
      new Request(base, { headers: { authorization: `Bearer ${f.secret}` } }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: f.projectId })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBeTruthy()
    const unexpectedQuery = await handlePublicApiRequest(
      new Request(base + '?secret=never-return-this', {
        headers: { authorization: `Bearer ${f.secret}` },
      }),
    )
    expect(unexpectedQuery.status).toBe(422)
    expect(await unexpectedQuery.text()).not.toContain('never-return-this')
    const withoutKey = await handlePublicApiRequest(
      new Request(base, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${f.secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'renamed',
          settingsVersion: f.settingsVersion,
        }),
      }),
    )
    expect(withoutKey.status).toBe(400)
    expect(await withoutKey.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_REQUIRED' },
    })
    const crossOrigin = await handlePublicApiRequest(
      new Request(base, {
        headers: {
          authorization: `Bearer ${f.secret}`,
          origin: 'https://other.example',
        },
      }),
    )
    expect(crossOrigin.status).toBe(403)
    const wrongMethod = await handlePublicApiRequest(
      new Request(base, { method: 'POST' }),
    )
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toContain('GET')
  })

  test('HTTP body limits and unexpected diagnostics never disclose submitted secrets', async () => {
    const f = await fixture()
    const headers = {
      authorization: `Bearer ${f.secret}`,
      'content-type': 'application/json',
      'idempotency-key': 'body-test',
    }
    const tooLarge = await handlePublicApiRequest(
      new Request('https://devpush.example/api/v1/servers', {
        method: 'POST',
        headers,
        body: 'x'.repeat(129 * 1024),
      }),
    )
    expect(tooLarge.status).toBe(413)
    const originalError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const batch = vi
      .spyOn(db, 'batch')
      .mockRejectedValueOnce(new Error('provider-secret-internal-diagnostic'))
    const failed = await handlePublicApiRequest(
      new Request('https://devpush.example/api/v1/servers', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'api-server' }),
      }),
    )
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain(
      'provider-secret-internal-diagnostic',
    )
    expect(originalError).toHaveBeenCalledWith(
      'Public API request failed',
      expect.objectContaining({
        requestId: expect.any(String),
        errorName: 'Error',
      }),
    )
    batch.mockRestore()
    originalError.mockRestore()
  })
  test('collection cursors are stable across equal creation times and reject other resources', async () => {
    const f = await fixture()
    const now = new Date()
    await db.insert(projects).values(
      Array.from({ length: 3 }, (_, index) => ({
        id: crypto.randomUUID(),
        teamId: f.teamId,
        name: `page-${index}`,
        slug: `page-${index}`,
        githubRepo: 'owner/repo',
        createdAt: now,
        updatedAt: now,
      })),
    )
    const first = await f.execute('list_projects', { limit: 2 })
    const page = first.data as { items: { id: string }[]; nextCursor: string }
    const second = await f.execute('list_projects', {
      limit: 2,
      cursor: page.nextCursor,
    })
    expect(
      new Set(
        [
          ...page.items,
          ...(second.data as { items: { id: string }[] }).items,
        ].map((row) => row.id),
      ).size,
    ).toBe(4)
    await expect(
      f.execute('list_servers', { cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
    await expect(
      f.execute('list_projects', { limit: 101 }),
    ).rejects.toHaveProperty('name', 'ZodError')
  })

  test('revocation immediately before deployment admission commits no deployment, cancellation, audit or replay', async () => {
    const f = await fixture()
    const original = db.batch.bind(db)
    const spy = vi
      .spyOn(db, 'batch')
      .mockImplementationOnce(async (queries) => {
        await db
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(eq(apiKeys.id, f.credentialId))
        return original(queries)
      })
    await expect(
      f.execute('redeploy', {
        deploymentId: f.deploymentId,
        idempotencyKey: 'revoked-race',
      }),
    ).rejects.toBeDefined()
    spy.mockRestore()
    expect(
      await db
        .select({ id: deployments.id })
        .from(deployments)
        .where(eq(deployments.environmentId, f.environmentId)),
    ).toEqual([{ id: f.deploymentId }])
    expect(
      await db
        .select()
        .from(apiIdempotency)
        .where(eq(apiIdempotency.membershipId, f.membershipId)),
    ).toHaveLength(0)
    expect(
      await db.select().from(apiAudit).where(eq(apiAudit.userId, f.userId)),
    ).toHaveLength(0)
  })

  test('server lifecycle and project deletion replay correctly after the resource is deleted', async () => {
    const f = await fixture()
    const disable = {
      serverId: f.serverId,
      confirmationName: 'server',
      idempotencyKey: 'disable',
    }
    expect(await f.execute('disable_server', disable)).toEqual(
      await f.execute('disable_server', disable),
    )
    const enable = { serverId: f.serverId, idempotencyKey: 'enable' }
    expect(await f.execute('enable_server', enable)).toEqual(
      await f.execute('enable_server', enable),
    )
    const deleteProject = {
      projectId: f.projectId,
      confirmationName: 'api-project',
      removeDeployments: false,
      idempotencyKey: 'delete',
    }
    const deleted = await f.execute('delete_project', deleteProject)
    expect(deleted.data).toMatchObject({ status: 'deleted' })
    expect(await f.execute('delete_project', deleteProject)).toEqual(deleted)
    const deleteServer = {
      serverId: f.serverId,
      confirmationName: 'server',
      idempotencyKey: 'delete',
    }
    expect(await f.execute('delete_server', deleteServer)).toEqual(
      await f.execute('delete_server', deleteServer),
    )
  })

  test('configuration writes enforce a separate host command scope and exact revision', async () => {
    const f = await fixture()
    const config = {
      projectId: f.projectId,
      settingsVersion: f.settingsVersion,
      runtimeConfig: createComposeRuntimeConfig({
        path: 'compose.yml',
        deployCommand: 'echo approved',
      }),
      routes: [],
      idempotencyKey: 'configure',
    }
    await expect(
      executeApiOperation({
        operationId: 'update_project_configuration',
        input: config,
        principal: {
          ...f.principal,
          scopes: f.principal.scopes.filter(
            (scope) => scope !== 'projects:host-commands',
          ),
        },
        requestId: 'scope-test',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const saved = await f.execute('update_project_configuration', config)
    expect(await f.execute('update_project_configuration', config)).toEqual(
      saved,
    )
    await expect(
      f.execute('rename_project', {
        projectId: f.projectId,
        settingsVersion: f.settingsVersion,
        name: 'new-name',
        idempotencyKey: 'rename',
      }),
    ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  })

  test.each([false, true])(
    'configuration path change invalidates Compose metadata (changed=%s)',
    async (changed) => {
      const f = await fixture()
      const metadata = { services: ['old-service'], volumes: ['old-volume'] }
      await db
        .update(projects)
        .set({ composeMetadata: metadata })
        .where(eq(projects.id, f.projectId))
      const [snapshot] = await db
        .select({ settingsVersion: projects.settingsVersion })
        .from(projects)
        .where(eq(projects.id, f.projectId))
      await f.execute('update_project_configuration', {
        projectId: f.projectId,
        settingsVersion: snapshot!.settingsVersion,
        runtimeConfig: createComposeRuntimeConfig({
          path: changed ? 'other.yml' : 'compose.yml',
        }),
        routes: [],
        idempotencyKey: 'metadata-path',
      })
      const [row] = await db
        .select({ metadata: projects.composeMetadata })
        .from(projects)
        .where(eq(projects.id, f.projectId))
      expect(row?.metadata).toEqual(changed ? null : metadata)
    },
  )

  test('a member browser save cannot overwrite a host command changed while its provider read is in flight', async () => {
    const f = await fixture()
    await db
      .update(teamMembers)
      .set({ role: 'member' })
      .where(eq(teamMembers.id, f.membershipId))
    const next = createComposeRuntimeConfig({ path: 'compose.yml' })
    vi.mocked(fetchProjectComposeMetadata).mockImplementationOnce(async () => {
      await db
        .update(projects)
        .set({
          runtimeConfig: {
            ...next,
            deployCommand: 'echo approved-admin-command',
          },
          updatedAt: new Date(Date.now() + 1),
        })
        .where(eq(projects.id, f.projectId))
      return null
    })
    await expect(
      updateProjectSettings({
        userId: f.userId,
        teamSlug: `api-${f.teamId}`,
        currentProjectName: 'api-project',
        projectName: 'api-project',
        repoFullName: 'owner/repo',
        installationId: null,
        runtimeConfig: next,
      }),
    ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    const [row] = await db
      .select({ runtimeConfig: projects.runtimeConfig })
      .from(projects)
      .where(eq(projects.id, f.projectId))
    expect(row?.runtimeConfig).toMatchObject({
      deployCommand: 'echo approved-admin-command',
    })
  })

  test('environment assignments preserve a stable response revision and idempotency', async () => {
    const f = await fixture()
    const input = {
      projectId: f.projectId,
      settingsVersion: f.settingsVersion,
      defaultServerId: f.serverId,
      environmentServers: [{ environmentId: f.environmentId, serverId: null }],
      idempotencyKey: 'assign',
    }
    const saved = await f.execute('update_environment_servers', input)
    const [row] = await db
      .select({ settingsVersion: projects.settingsVersion })
      .from(projects)
      .where(eq(projects.id, f.projectId))
    expect(saved.data).toMatchObject({ settingsVersion: row!.settingsVersion })
    expect(await f.execute('update_environment_servers', input)).toEqual(saved)
  })

  test('backup destinations hide endpoint credentials and reject removal while a policy references them', async () => {
    const f = await fixture()
    const created = await f.execute('create_backup_storage', {
      name: 'Remote',
      bucket: 'api-backups',
      region: 'auto',
      endpoint:
        'https://user:embedded-secret@example.invalid/path?token=query-secret',
      accessKeyId: 'key-secret',
      secretAccessKey: 'storage-secret',
      idempotencyKey: 'storage',
    })
    const storageId = (created.data as { storageId: string }).storageId
    const listed = await f.execute('list_backup_storage', {})
    expect(JSON.stringify(listed)).not.toMatch(
      /embedded-secret|query-secret|key-secret|storage-secret/,
    )
    const policyId = crypto.randomUUID()
    await db.insert(backupConfigs).values({
      id: policyId,
      projectId: f.projectId,
      environmentId: f.environmentId,
      name: 'Policy',
      schedule: { cron: '0 2 * * *' },
      destination: { storageId },
      retention: {
        local: { count: 5, days: 7, maxStorageGb: 0 },
        remote: { enabled: true, count: 5, days: 7, maxStorageGb: 0 },
      },
    })
    await expect(
      f.execute('delete_backup_storage', {
        settingsVersion: 1,
        storageId,
        confirmation: 'delete-storage',
        idempotencyKey: 'remove',
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_STORAGE_IN_USE' })
    expect(
      await db
        .select()
        .from(backupStorage)
        .where(eq(backupStorage.id, storageId)),
    ).toHaveLength(1)
    expect(
      JSON.stringify(
        await db
          .select()
          .from(apiIdempotency)
          .where(eq(apiIdempotency.membershipId, f.membershipId)),
      ),
    ).not.toContain('storage-secret')
  })

  test('backup and restore admission share replay guarantees and prevent concurrent restores for one runtime', async () => {
    const f = await fixture()
    const policyId = crypto.randomUUID()
    await db.insert(backupConfigs).values({
      id: policyId,
      projectId: f.projectId,
      environmentId: f.environmentId,
      name: 'Local',
      schedule: { cron: '0 2 * * *' },
      destination: {},
      retention: {
        local: { count: 5, days: 7, maxStorageGb: 0 },
        remote: { enabled: false, count: 0, days: 0, maxStorageGb: 0 },
      },
    })
    const input = {
      projectId: f.projectId,
      environmentId: f.environmentId,
      policyId,
      idempotencyKey: 'backup',
    }
    const first = await f.execute('run_backup', input)
    expect(await f.execute('run_backup', input)).toEqual(first)
    const backupRunId = (first.data as { backupRunId: string }).backupRunId
    const artifactId = crypto.randomUUID()
    await db
      .update(backupRuns)
      .set({ status: 'succeeded' })
      .where(eq(backupRuns.id, backupRunId))
    await db.insert(backupArtifacts).values({
      id: artifactId,
      backupRunId,
      type: 'volume',
      storage: 'local',
      objectKey: '/backups/data.tar.gz',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 50,
    })
    const restore = {
      backupRunId,
      confirmation: 'restore',
      artifacts: [{ artifactId, type: 'volume', targetVolume: 'data' }],
      idempotencyKey: 'restore',
    }
    const restored = await f.execute('restore_backup', restore)
    expect(await f.execute('restore_backup', restore)).toEqual(restored)
    await expect(
      f.execute('restore_backup', {
        ...restore,
        idempotencyKey: 'another-restore',
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_ALREADY_ACTIVE' })
    expect(
      (
        await db
          .select()
          .from(agentJobs)
          .where(eq(agentJobs.projectId, f.projectId))
      ).filter((job) => job.type === 'restore'),
    ).toHaveLength(1)
  })
  test('project and deployment reads do not disclose secrets or bootstrap new records', async () => {
    const f = await fixture()
    const project = await f.execute('get_project', { projectId: f.projectId })
    expect(project.data).toMatchObject({
      id: f.projectId,
      repository: 'owner/repo',
    })
    expect(JSON.stringify(project)).not.toContain('hidden')
    const deployment = await f.execute('get_deployment', {
      deploymentId: f.deploymentId,
    })
    expect(JSON.stringify(deployment)).not.toContain(
      'encrypted-deployment-secret',
    )
    expect(deployment.data).not.toHaveProperty('config')
    const variables = await f.execute('list_variables', {
      projectId: f.projectId,
    })
    expect(variables.data).toMatchObject({
      items: expect.arrayContaining([{ key: 'KEEP', environmentId: null }]),
    })
    expect(JSON.stringify(variables)).not.toContain('hidden')
  })

  test('scope and project constraints prevent access to other projects and team-wide server data', async () => {
    const f = await fixture()
    const restricted = { ...f.principal, projectIds: [f.projectId] }
    await expect(
      executeApiOperation({
        operationId: 'list_servers',
        input: {},
        principal: restricted,
        requestId: 'test',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      executeApiOperation({
        operationId: 'get_project',
        input: { projectId: 'other' },
        principal: restricted,
        requestId: 'test',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      executeApiOperation({
        operationId: 'redeploy',
        input: { deploymentId: f.deploymentId, idempotencyKey: 'test' },
        principal: { ...f.principal, scopes: ['deployments:read'] },
        requestId: 'test',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('revocation, expiry, ban and membership replacement reject a previously authenticated principal', async () => {
    const f = await fixture()
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, f.credentialId))
    await expect(
      f.execute('get_project', { projectId: f.projectId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const banned = await fixture()
    await db
      .update(user)
      .set({ status: 'banned' })
      .where(eq(user.id, banned.userId))
    await expect(
      banned.execute('get_project', { projectId: banned.projectId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const removed = await fixture()
    await db.delete(teamMembers).where(eq(teamMembers.id, removed.membershipId))
    await db.insert(teamMembers).values({
      id: crypto.randomUUID(),
      teamId: removed.teamId,
      userId: removed.userId,
      role: 'owner',
    })
    await expect(
      removed.execute('get_project', { projectId: removed.projectId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('repeated redeploy admission returns one resource without canceling itself', async () => {
    const f = await fixture()
    const input = {
      deploymentId: f.deploymentId,
      idempotencyKey: 'same-request',
    }
    const [first, second] = await Promise.all([
      f.execute('redeploy', input),
      f.execute('redeploy', input),
    ])
    expect(first).toEqual(second)
    const rows = await db
      .select({
        id: deployments.id,
        status: deployments.status,
        trigger: deployments.trigger,
      })
      .from(deployments)
      .where(eq(deployments.environmentId, f.environmentId))
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id !== f.deploymentId)?.status).toBe('queued')
    expect(rows.find((row) => row.id !== f.deploymentId)?.trigger).toBe('api')
    expect(
      await db
        .select()
        .from(apiAudit)
        .where(eq(apiAudit.operation, 'redeploy')),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(apiIdempotency)
        .where(eq(apiIdempotency.membershipId, f.membershipId)),
    ).toHaveLength(1)
  })

  test('variable patches preserve omitted values, reject stale revisions and keep plaintext out of audit/replay', async () => {
    const f = await fixture()
    const input = {
      projectId: f.projectId,
      settingsVersion: f.settingsVersion,
      changes: [{ key: 'CHANGE', environmentId: null, value: 'new-secret' }],
      idempotencyKey: 'patch',
    }
    const result = await f.execute('update_variables', input)
    expect(result.data).toHaveProperty('settingsVersion')
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, f.projectId))
    expect(readProjectEnvVars(project!)).toEqual(
      expect.arrayContaining([
        { key: 'KEEP', value: 'hidden' },
        { key: 'CHANGE', value: 'new-secret' },
      ]),
    )
    expect(await f.execute('update_variables', input)).toEqual(result)
    await expect(
      f.execute('update_variables', {
        ...input,
        changes: [{ key: 'CHANGE', environmentId: null, value: 'different' }],
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await expect(
      f.execute('update_variables', {
        ...input,
        idempotencyKey: 'new-request',
      }),
    ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    const records = await db
      .select()
      .from(apiIdempotency)
      .where(eq(apiIdempotency.membershipId, f.membershipId))
    expect(JSON.stringify(records)).not.toContain('new-secret')
    expect(JSON.stringify(records)).not.toContain('hidden')
  })

  test('log pages bound bytes and cursor context, and honor the separate logs scope', async () => {
    const f = await fixture()
    await logsDb.insert(deploymentLogs).values(
      Array.from({ length: 6 }, (_, index) => ({
        deploymentId: f.deploymentId,
        projectId: f.projectId,
        environmentId: f.environmentId,
        serverId: f.serverId,
        branch: 'main',
        stream: 'deploy',
        seq: index + 1,
        content: 'x'.repeat(100_000),
        searchContent: 'x',
        createdAt: new Date(),
      })),
    )
    const first = await f.execute('read_deployment_logs', {
      deploymentId: f.deploymentId,
      limit: 10,
    })
    const data = first.data as {
      items: { content: string; truncated: boolean }[]
      nextCursor: string
    }
    expect(data.items.length).toBe(4)
    expect(
      data.items.every(
        (row) => row.content.length === 64 * 1024 && row.truncated,
      ),
    ).toBe(true)
    const second = await f.execute('read_deployment_logs', {
      deploymentId: f.deploymentId,
      limit: 10,
      cursor: data.nextCursor,
    })
    expect((second.data as { items: unknown[] }).items).toHaveLength(2)
    await expect(
      f.execute('read_deployment_logs', {
        deploymentId: f.deploymentId,
        stream: 'control',
        cursor: data.nextCursor,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
  })
})

test('disabled backups reject every API/MCP mutation without reserving or writing', async () => {
  const f = await fixture()
  const previous = installationConfig.DEVPUSH_BACKUPS_ENABLED
  const id = crypto.randomUUID()
  const policy = {
    projectId: f.projectId,
    name: 'Disabled policy',
    environmentId: f.environmentId,
    enabled: true,
    schedule: { cron: '0 2 * * *' },
    destination: {},
    retention: {
      local: { count: 7, days: 0, maxStorageGb: 0 },
      remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
    },
    volumes: { mode: 'allNamed', names: [] },
    databaseDumps: [],
    idempotencyKey: 'disabled-policy',
  }
  const storage = {
    name: 'Disabled storage',
    bucket: 'disabled-backups',
    region: 'auto',
    endpoint: '',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    idempotencyKey: 'disabled-storage',
  }
  const cases: Array<[string, unknown]> = [
    ['create_backup_policy', policy],
    ['update_backup_policy', { ...policy, policyId: id, settingsVersion: 1 }],
    [
      'delete_backup_policy',
      {
        projectId: f.projectId,
        policyId: id,
        confirmation: 'delete-policy',
        settingsVersion: 1,
        idempotencyKey: 'disabled-delete-policy',
      },
    ],
    ['create_backup_storage', storage],
    [
      'update_backup_storage',
      { ...storage, storageId: id, settingsVersion: 1 },
    ],
    [
      'delete_backup_storage',
      {
        storageId: id,
        confirmation: 'delete-storage',
        settingsVersion: 1,
        idempotencyKey: 'disabled-delete-storage',
      },
    ],
    [
      'run_backup',
      {
        projectId: f.projectId,
        environmentId: f.environmentId,
        idempotencyKey: 'disabled-run',
      },
    ],
    [
      'restore_backup',
      {
        backupRunId: id,
        confirmation: 'restore',
        artifacts: [{ type: 'volume', artifactId: id, targetVolume: 'data' }],
        idempotencyKey: 'disabled-restore',
      },
    ],
  ]
  try {
    installationConfig.DEVPUSH_BACKUPS_ENABLED = false
    for (const [operation, input] of cases) {
      await expect(f.execute(operation, input)).rejects.toMatchObject({
        code: 'BACKUPS_DISABLED',
      })
    }
    expect(
      await db
        .select()
        .from(apiIdempotency)
        .where(eq(apiIdempotency.credentialId, f.credentialId)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(apiAudit)
        .where(eq(apiAudit.credentialId, f.credentialId)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(backupConfigs)
        .where(eq(backupConfigs.projectId, f.projectId)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(backupStorage)
        .where(eq(backupStorage.teamId, f.teamId)),
    ).toHaveLength(0)
    expect(
      (await f.execute('list_backup_policies', { projectId: f.projectId }))
        .status,
    ).toBe(200)
  } finally {
    installationConfig.DEVPUSH_BACKUPS_ENABLED = previous
  }
})

test('API and browser policy saves share normalization, remote requirements and versions', async () => {
  const f = await fixture()
  const policy = {
    name: 'Shared policy',
    environmentId: f.environmentId,
    enabled: true,
    schedule: { cron: '0 2 * * *' },
    destination: {},
    retention: {
      local: { count: 7, days: 0, maxStorageGb: 0 },
      remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
    },
    volumes: { mode: 'none' as const, names: ['ignored'] },
    databaseDumps: [],
  }
  const browserId = crypto.randomUUID()
  await saveProjectBackupPolicy({
    userId: f.userId,
    projectId: f.projectId,
    teamSlug: 'api-' + f.teamId,
    projectName: 'api-project',
    settingsVersion: null,
    policy: { ...policy, id: browserId },
  })
  const request = {
    ...policy,
    projectId: f.projectId,
    idempotencyKey: 'shared-policy',
  }
  const api = await f.execute('create_backup_policy', request)
  expect(await f.execute('create_backup_policy', request)).toEqual(api)
  const id = (api.data as { policyId: string }).policyId
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.projectId, f.projectId))
  for (const row of rows) {
    expect(row.volumes).toEqual({ mode: 'none', names: [] })
    expect(row.destination).toEqual({
      prefix:
        'projects/' +
        f.projectId +
        '/environments/' +
        f.environmentId +
        '/backups/' +
        row.id,
    })
    expect(row.settingsVersion).toBe(1)
  }
  expect(rows).toHaveLength(2)
  expect(
    await db
      .select()
      .from(apiAudit)
      .where(eq(apiAudit.credentialId, f.credentialId)),
  ).toHaveLength(1)
  await f.execute('update_backup_policy', {
    ...policy,
    volumes: { mode: 'selected', names: [] },
    projectId: f.projectId,
    policyId: id,
    settingsVersion: 1,
    idempotencyKey: 'shared-update',
  })
  await expect(
    saveProjectBackupPolicy({
      userId: f.userId,
      projectId: f.projectId,
      teamSlug: 'api-' + f.teamId,
      projectName: 'api-project',
      settingsVersion: 1,
      policy: { ...policy, id, name: 'Stale browser policy' },
    }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  expect(
    (await db.select().from(backupConfigs).where(eq(backupConfigs.id, id)))[0],
  ).toMatchObject({
    settingsVersion: 2,
    name: 'Shared policy',
    volumes: { mode: 'allNamed', names: [] },
  })
  const foreign = await fixture()
  await expect(
    f.execute('create_backup_policy', {
      ...policy,
      projectId: f.projectId,
      environmentId: foreign.environmentId,
      idempotencyKey: 'foreign-policy-environment',
    }),
  ).rejects.toMatchObject({ code: 'BACKUP_ENVIRONMENT_INVALID' })
  await expect(
    saveProjectBackupPolicy({
      userId: f.userId,
      projectId: f.projectId,
      teamSlug: 'api-' + f.teamId,
      projectName: 'api-project',
      settingsVersion: 1,
      policy: {
        ...policy,
        id: browserId,
        environmentId: foreign.environmentId,
      },
    }),
  ).rejects.toMatchObject({ code: 'BACKUP_ENVIRONMENT_INVALID' })
  expect(
    await db
      .select()
      .from(backupConfigs)
      .where(eq(backupConfigs.projectId, f.projectId)),
  ).toHaveLength(2)
  const remote = {
    ...policy,
    retention: {
      ...policy.retention,
      remote: { ...policy.retention.remote, enabled: true },
    },
  }
  await expect(
    f.execute('create_backup_policy', {
      ...remote,
      projectId: f.projectId,
      idempotencyKey: 'missing-remote-storage',
    }),
  ).rejects.toMatchObject({ code: 'BACKUP_STORAGE_REQUIRED' })
  await expect(
    saveProjectBackupPolicy({
      userId: f.userId,
      projectId: f.projectId,
      teamSlug: 'api-' + f.teamId,
      projectName: 'api-project',
      settingsVersion: null,
      policy: { ...remote, id: crypto.randomUUID() },
    }),
  ).rejects.toMatchObject({ code: 'BACKUP_STORAGE_REQUIRED' })
})

test('retained remote artifacts protect storage after a local cleanup has finished', async () => {
  const f = await fixture()
  const created = await f.execute('create_backup_storage', {
    name: 'Retained archive storage',
    bucket: 'retained-backups',
    region: 'auto',
    endpoint: '',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    idempotencyKey: 'retained-storage',
  })
  const storageId = (created.data as { storageId: string }).storageId
  const runId = crypto.randomUUID()
  await db.insert(backupRuns).values({
    id: runId,
    projectId: f.projectId,
    environmentId: f.environmentId,
    serverId: f.serverId,
    runtimeId: 'test-runtime',
    status: 'succeeded',
    destination: { storageId, bucket: 'retained-backups' },
    finishedAt: new Date(),
    cleanupFinishedAt: new Date(),
  })
  await db.insert(backupArtifacts).values({
    id: crypto.randomUUID(),
    backupRunId: runId,
    type: 'volume',
    storage: 'remote',
    objectKey: 'retained/data.tar.gz',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 100,
  })
  await expect(
    f.execute('delete_backup_storage', {
      storageId,
      settingsVersion: 1,
      confirmation: 'delete-storage',
      idempotencyKey: 'still-retained',
    }),
  ).rejects.toMatchObject({ code: 'BACKUP_STORAGE_IN_USE' })
  expect(
    await db
      .select()
      .from(backupStorage)
      .where(eq(backupStorage.id, storageId)),
  ).toHaveLength(1)
})

test.each([
  [
    'deploy',
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      projectId: f.projectId,
      environmentId: f.environmentId,
      branch: 'main',
    }),
  ],
  [
    'redeploy',
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      deploymentId: f.deploymentId,
    }),
  ],
  [
    'rollback',
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      deploymentId: f.deploymentId,
      confirmation: 'rollback',
    }),
  ],
  [
    'rename_project',
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      projectId: f.projectId,
      name: 'blocked',
      settingsVersion: 1,
    }),
  ],
  [
    'rename_server',
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      serverId: f.serverId,
      name: 'blocked',
      settingsVersion: 1,
    }),
  ],
  [
    'update_variables',
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      projectId: f.projectId,
      changes: [{ key: 'BLOCKED', environmentId: null, value: 'secret' }],
      settingsVersion: 1,
    }),
  ],
  [
    'disable_server',
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      serverId: f.serverId,
      confirmationName: 'server',
    }),
  ],
  [
    'delete_project',
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      projectId: f.projectId,
      confirmationName: 'project',
      removeDeployments: false,
    }),
  ],
] as const)(
  'policy denial for %s never writes effects, audit or replay records',
  async (operation, input) => {
    const f = await fixture()
    workspacePolicy.run.mockRejectedValueOnce(
      new WorkspacePolicyError('restricted'),
    )
    await expect(
      f.execute(operation, {
        ...input(f),
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_RESTRICTED' })
    expect(
      await db
        .select()
        .from(apiIdempotency)
        .where(eq(apiIdempotency.credentialId, f.credentialId)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(apiAudit)
        .where(eq(apiAudit.credentialId, f.credentialId)),
    ).toHaveLength(0)
    expect(
      (await db.select().from(servers).where(eq(servers.id, f.serverId)))[0]
        ?.status,
    ).toBe('connected')
    expect(
      (await db.select().from(projects).where(eq(projects.id, f.projectId)))[0]
        ?.status,
    ).toBe('active')
  },
)

test('browser workspace policy runs before avatar upload or project provider changes', async () => {
  const f = await fixture()
  const { updateTeamGeneral } = await import('#devpush/server/teams/service')
  workspacePolicy.run.mockRejectedValueOnce(
    new WorkspacePolicyError('restricted'),
  )
  await expect(
    updateTeamGeneral({
      userId: f.userId,
      teamSlug: `api-${f.teamId}`,
      name: 'Blocked',
      slug: `api-${f.teamId}`,
      avatarDataUrl: 'invalid-image',
    }),
  ).rejects.toMatchObject({ code: 'WORKSPACE_RESTRICTED' })
  expect(
    (await db.select().from(teams).where(eq(teams.id, f.teamId)))[0]
      ?.avatarPath,
  ).toBeNull()
  workspacePolicy.run.mockRejectedValueOnce(
    new WorkspacePolicyError('restricted'),
  )
  await expect(
    updateProjectSettings({
      userId: f.userId,
      teamSlug: `api-${f.teamId}`,
      currentProjectName: 'api-project',
      projectName: 'blocked',
      repoFullName: 'owner/repo',
      installationId: 1,
      avatarDataUrl: 'invalid-image',
      runtimeConfig: createComposeRuntimeConfig({ path: 'compose.yml' }),
    }),
  ).rejects.toMatchObject({ code: 'WORKSPACE_RESTRICTED' })
  expect(
    (await db.select().from(projects).where(eq(projects.id, f.projectId)))[0]
      ?.name,
  ).toBe('api-project')
})

test('expired queued deployments remain queued and never receive repository credentials', async () => {
  const f = await fixture()
  const { claimNextDeploymentJob } = await import('#devpush/server/agents/jobs')
  await db
    .update(deployments)
    .set({ status: 'queued', phase: 'queued' })
    .where(eq(deployments.id, f.deploymentId))
  const createAccessToken = vi.fn()
  workspacePolicy.run.mockRejectedValueOnce(
    new WorkspacePolicyError('restricted'),
  )
  expect(
    await claimNextDeploymentJob({
      serverId: f.serverId,
      token: 'unused',
      skipAgentAuth: true,
      createAccessToken,
    }),
  ).toBeNull()
  expect(createAccessToken).not.toHaveBeenCalled()
  expect(
    (
      await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, f.deploymentId))
    )[0]?.status,
  ).toBe('queued')
})

test('REST creation cannot commit after owner demotion during policy admission', async () => {
  const f = await fixture()
  workspacePolicy.run.mockImplementationOnce(async (_input, action) => {
    await db
      .update(teamMembers)
      .set({ role: 'admin' })
      .where(eq(teamMembers.id, f.membershipId))
    return action()
  })
  await expect(
    f.execute('create_server', {
      name: 'must-not-charge',
      idempotencyKey: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  expect(
    await db.select().from(servers).where(eq(servers.teamId, f.teamId)),
  ).toHaveLength(1)
  expect(
    await db
      .select()
      .from(apiIdempotency)
      .where(eq(apiIdempotency.credentialId, f.credentialId)),
  ).toHaveLength(0)
})
