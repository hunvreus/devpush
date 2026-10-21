import { recordAgentMetricSamples } from '@/server/servers/metric-history'
import { required } from '@/test/required'
import { openWorkerDatabases } from './worker-connection'
import { and, eq, sql } from 'drizzle-orm'
import { createD1TestStores } from '@/test/d1'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { openD1 } from './d1-connection'
import * as schema from './schema'
import * as logSchema from './log-schema'
import {
  mutateTeamMembership,
  mutateTeamOwnership,
  leaveMembership,
} from '@/server/teams/membership'
import { acceptInvitation } from '@/server/teams/invitations'
import { bootstrapOwnedTeam, insertOwnedTeam } from '@/server/teams/creation'
import {
  deleteServerState,
  changeServerEnabled,
} from '@/server/servers/lifecycle'
import { reconcileRuntimeState } from '@/server/agents/runtime-state'
import {
  enqueueBackup,
  enqueueBackupCleanup,
} from '@/server/backups/queue-state'
import { insertProject } from '@/server/projects/creation-state'
import {
  EnvironmentStateChanged,
  replaceProjectEnvironments,
} from '@/server/projects/environment-state'
import { enqueueDeployment } from '@/server/projects/queue-state'
import { replaceProjectRoutes } from '@/server/projects/route-state'
import { saveProjectBackupPolicyState } from '@/server/projects/backup-policy-state'
import { replaceProjectDomains } from '@/server/projects/domain-state'
import {
  failStaleAgentJob,
  finishBackup,
  finishBackupCleanup,
} from '@/server/agents/backup-state'
import {
  failRunningDeployments,
  finishDeployment,
} from '@/server/agents/deployment-state'
import {
  claimBackupCandidate,
  claimCleanup,
  claimDeployment,
} from '@/server/agents/claims'

let runtime:
  | Awaited<ReturnType<typeof createD1TestStores>>['runtime']
  | undefined
let main: ReturnType<typeof openD1<typeof schema>>
let logs: ReturnType<typeof openD1<typeof logSchema>>
beforeAll(async () => {
  ;({ runtime, main, logs } = await createD1TestStores())
}, 30_000)

afterAll(async () => runtime?.dispose())

describe('local D1 storage', () => {
  test('backup policy saves enforce their own version and live roles on D1', async () => {
    const teamId = 'backup-guard-team',
      userId = 'backup-guard-user',
      projectId = 'backup-guard-project',
      environmentId = 'backup-guard-env'
    const revision = new Date()
    await main
      .insert(schema.teams)
      .values({ id: teamId, name: teamId, slug: teamId })
    await main.insert(schema.user).values({
      id: userId,
      name: userId,
      username: userId,
      email: `${userId}@example.invalid`,
    })
    await main
      .insert(schema.teamMembers)
      .values({ id: 'backup-guard-member', teamId, userId, role: 'admin' })
    await main.insert(schema.projects).values({
      id: projectId,
      teamId,
      name: projectId,
      slug: projectId,
      githubRepo: 'test/repo',
      runtimeConfig: { kind: 'compose' },
      updatedAt: revision,
    })
    await main.insert(schema.environments).values({
      id: environmentId,
      projectId,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      runtimeId: 'dp_backup_guard',
    })
    const configs: Array<typeof schema.backupConfigs.$inferInsert> = Array.from(
      { length: 20 },
      (_, index) => ({
        id: `backup-guard-policy-${index}`,
        name: `Policy ${index}`,
        projectId,
        environmentId,
        enabled: true,
        destinationType: 's3',
        destination: {},
        schedule: { cron: '0 2 * * *' },
        retention: {
          local: { count: 7, days: 0, maxStorageGb: 0 },
          remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
        },
        volumes: { mode: 'none', names: [] },
        databaseDumps: [],
      }),
    )
    const input = {
      projectId,
      teamId,
      userId,
      settingsVersion: null,
      now: new Date(),
      policy: {
        ...required(configs[0]),
        id: required(configs[0]).id,
        name: required(configs[0]).name,
        environmentId,
        enabled: true,
        destination: {},
        schedule: { cron: '0 2 * * *' },
        retention: required(configs[0]).retention,
        volumes: { mode: 'none', names: [] },
        databaseDumps: [],
      },
    }
    expect(await saveProjectBackupPolicyState(main, input)).toBe(true)
    expect(
      await saveProjectBackupPolicyState(main, {
        ...input,
        settingsVersion: 1,
        policy: { ...input.policy, name: 'Updated' },
      }),
    ).toBe(true)
    expect(
      await saveProjectBackupPolicyState(main, {
        ...input,
        settingsVersion: 1,
      }),
    ).toBe(false)
    await main
      .update(schema.teamMembers)
      .set({ role: 'member' })
      .where(eq(schema.teamMembers.userId, userId))
    expect(
      await saveProjectBackupPolicyState(main, {
        ...input,
        settingsVersion: 2,
      }),
    ).toBe(false)
    const [saved] = await main
      .select()
      .from(schema.backupConfigs)
      .where(eq(schema.backupConfigs.id, input.policy.id))
    expect(saved?.name).toBe('Updated')
    expect(saved?.settingsVersion).toBe(2)
  })
  test('stores full metric batches with original times and idempotent retries on D1', async () => {
    await main
      .insert(schema.teams)
      .values({ id: 'metric-team', slug: 'metric-team', name: 'Metric team' })
    await main.insert(schema.servers).values({
      id: 'metric-server',
      teamId: 'metric-team',
      name: 'Metric server',
      handle: 'metric-server',
    })
    const now = new Date()
    const samples = Array.from({ length: 240 }, (_, index) => ({
      id: index.toString(16).padStart(32, '0'),
      observedAt: now.toISOString(),
      metrics: { cpuPercent: 1 },
    }))
    expect(
      await recordAgentMetricSamples('metric-server', samples, now, main),
    ).toBe(samples.at(-1)?.id)
    await recordAgentMetricSamples('metric-server', samples, now, main)
    const rows = await main
      .select()
      .from(schema.serverMetrics)
      .where(eq(schema.serverMetrics.serverId, 'metric-server'))
    expect(rows).toHaveLength(240)
    expect(rows[0]?.observedAt).toEqual(now)
  })

  test('encodes raw dates and booleans in individual queries and atomic batches', async () => {
    const now = new Date('2026-10-04T09:00:00Z')
    const query = () =>
      main
        .select({
          timestamp: sql<number>`${now}`.as('timestamp'),
          enabled: sql<number>`${true}`.as('enabled'),
        })
        .from(schema.rateLimits)
        .limit(1)
    await main
      .insert(schema.rateLimits)
      .values({ key: 'parameter-test', count: 1, resetAt: now })
    const expected = [{ timestamp: now.getTime(), enabled: 1 }]
    expect(await query()).toEqual(expected)
    expect(await main.batch([query()])).toEqual([expected])
  })

  test('enqueues backup runs and jobs atomically while excluding active runs and repeated schedules', async () => {
    const retention = {
      local: { count: 7, days: 0, maxStorageGb: 0 },
      remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
    }
    await main.batch([
      main
        .insert(schema.teams)
        .values({ id: 'enqueue-team', name: 'Enqueue', slug: 'enqueue-team' }),
      main.insert(schema.servers).values({
        id: 'enqueue-server',
        teamId: 'enqueue-team',
        name: 'Enqueue',
        handle: 'enqueue',
        status: 'connected',
      }),
      main.insert(schema.projects).values({
        id: 'enqueue-project',
        teamId: 'enqueue-team',
        name: 'enqueue-project',
        slug: 'enqueue-project',
        githubRepo: 'example/project',
      }),
      main.insert(schema.environments).values({
        id: 'enqueue-environment',
        projectId: 'enqueue-project',
        serverId: 'enqueue-server',
        name: 'Production',
        slug: 'production',
        branch: 'main',
        runtimeId: 'enqueue-runtime',
      }),
      main.insert(schema.backupConfigs).values({
        id: 'enqueue-config',
        projectId: 'enqueue-project',
        environmentId: 'enqueue-environment',
        name: 'Daily',
        destination: { bucket: 'test-backups' },
        retention,
        schedule: { cron: '0 0 * * *' },
      }),
    ])
    const base = {
      configId: 'enqueue-config',
      projectId: 'enqueue-project',
      environmentId: 'enqueue-environment',
      deploymentId: null,
      serverId: 'enqueue-server',
      runtimeId: 'enqueue-runtime',
      scheduleKey: 'daily-1',
      manifest: null,
      now: new Date(),
    }
    const candidate = (suffix: string) => ({
      ...base,
      backupRunId: `enqueue-run-${suffix}`,
      agentJobId: `enqueue-job-${suffix}`,
      payload: {
        schemaVersion: 1 as const,
        backupRunId: `enqueue-run-${suffix}`,
        projectId: base.projectId,
        environmentId: base.environmentId,
        runtimeId: base.runtimeId,
        artifactPrefix: 'backups/',
        localBasePath: '/backups/run',
        destination: { bucket: 'test-backups' },
        retention,
        volumes: { mode: 'allNamed' as const, names: [] },
        databaseDumps: [],
      },
    })
    await main.run(sql`create trigger reject_enqueue before insert on agent_jobs when new.id = 'enqueue-job-failure'
      begin select raise(abort, 'simulated enqueue failure'); end`)
    try {
      await expect(enqueueBackup(main, candidate('failure'))).rejects.toThrow(
        'simulated enqueue failure',
      )
      expect(
        await main
          .select()
          .from(schema.backupRuns)
          .where(eq(schema.backupRuns.id, 'enqueue-run-failure')),
      ).toEqual([])
    } finally {
      await main.run(sql`drop trigger reject_enqueue`)
    }
    const candidates = [candidate('a'), candidate('b')]
    const results = await Promise.all(
      candidates.map((input) => enqueueBackup(main, input)),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    const winner = candidates[results.indexOf(true)]
    expect(
      await main
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.projectId, base.projectId)),
    ).toHaveLength(1)
    await main
      .update(schema.backupRuns)
      .set({ status: 'succeeded' })
      .where(eq(schema.backupRuns.id, required(winner).backupRunId))
    expect(await enqueueBackup(main, candidate('repeat'))).toBe(false)
    await expect(
      enqueueBackup(main, { ...required(winner), agentJobId: 'collision-job' }),
    ).rejects.toThrow()
    expect(
      await main
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.id, 'collision-job')),
    ).toEqual([])
    await main
      .update(schema.backupConfigs)
      .set({ enabled: false })
      .where(eq(schema.backupConfigs.id, base.configId))
    expect(
      await enqueueBackup(main, {
        ...candidate('disabled'),
        scheduleKey: null,
      }),
    ).toBe(false)
  })

  test('enqueues cleanup from the currently unclaimed runs and rolls job creation back with its markers', async () => {
    await main.insert(schema.backupRuns).values(
      ['retained-a', 'retained-b'].map((id) => ({
        id,
        projectId: 'enqueue-project',
        environmentId: 'enqueue-environment',
        serverId: 'enqueue-server',
        runtimeId: 'enqueue-runtime',
        status: 'succeeded' as const,
        cleanupQueuedAt: id === 'retained-a' ? new Date() : null,
      })),
    )
    const input = {
      jobId: 'retained-job',
      projectId: 'enqueue-project',
      serverId: 'enqueue-server',
      backupRunIds: ['retained-a', 'retained-b'],
      now: new Date(),
      destination: { bucket: 'test-backups' },
      artifacts: [
        {
          backupRunId: 'retained-a',
          storage: 'local' as const,
          objectKey: '/backups/a',
        },
        {
          backupRunId: 'retained-b',
          storage: 'remote' as const,
          objectKey: 'backups/b',
        },
      ],
    }
    await main.run(sql`create trigger reject_retention_marker before update of cleanup_queued_at on backup_runs
      when new.id = 'retained-b' and new.cleanup_queued_at is not null begin select raise(abort, 'simulated retention failure'); end`)
    try {
      await expect(enqueueBackupCleanup(main, input)).rejects.toThrow(
        'simulated retention failure',
      )
      expect(
        await main
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.id, input.jobId)),
      ).toEqual([])
    } finally {
      await main.run(sql`drop trigger reject_retention_marker`)
    }
    const results = await Promise.all([
      enqueueBackupCleanup(main, input),
      enqueueBackupCleanup(main, { ...input, jobId: 'retained-job-other' }),
    ])
    expect(results.flat()).toEqual(['retained-b'])
    const jobs = await main
      .select()
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.type, 'backup_cleanup'))
    const queued = jobs.find(
      (job) =>
        job.id === (results[0].length ? input.jobId : 'retained-job-other'),
    )!
    expect(queued.payload).toMatchObject({
      backupRunIds: ['retained-b'],
      localObjectKeys: [],
      remoteObjectKeys: ['backups/b'],
      destination: input.destination,
    })
    await expect(
      enqueueBackupCleanup(main, { ...input, jobId: queued.id }),
    ).rejects.toThrow()
  })

  test('replaces routes and clears only obsolete domain paths in one atomic batch', async () => {
    await main.insert(schema.domains).values([
      {
        id: 'route-default',
        projectId: 'enqueue-project',
        environmentId: 'enqueue-environment',
        hostname: 'default-route.example.com',
        basePath: '/',
      },
      {
        id: 'route-scoped',
        projectId: 'enqueue-project',
        environmentId: 'enqueue-environment',
        hostname: 'scoped-route.example.com',
        basePath: '/scoped',
      },
      {
        id: 'route-obsolete',
        projectId: 'enqueue-project',
        environmentId: 'enqueue-environment',
        hostname: 'obsolete-route.example.com',
        basePath: '/old',
      },
    ])
    const routes = [
      { path: '/', service: 'web', port: 3000, stripPrefix: false },
      {
        path: '/scoped',
        service: 'web',
        port: 3000,
        stripPrefix: false,
        environmentId: 'enqueue-environment',
      },
    ]
    const input = { projectId: 'enqueue-project', routes, now: new Date() }
    await main.run(sql`create trigger reject_domain_path before update of base_path on domains
      when old.id = 'route-obsolete' begin select raise(abort, 'simulated route failure'); end`)
    try {
      await expect(replaceProjectRoutes(main, input)).rejects.toThrow(
        'simulated route failure',
      )
      expect(
        required(
          (
            await main
              .select()
              .from(schema.projects)
              .where(eq(schema.projects.id, input.projectId))
          )[0],
        ).routes,
      ).toBeNull()
    } finally {
      await main.run(sql`drop trigger reject_domain_path`)
    }
    await replaceProjectRoutes(main, input)
    const domains = await main
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.projectId, input.projectId))
    expect(
      domains.find((domain) => domain.id === 'route-default')?.basePath,
    ).toBe('/')
    expect(
      domains.find((domain) => domain.id === 'route-scoped')?.basePath,
    ).toBe('/scoped')
    expect(
      domains.find((domain) => domain.id === 'route-obsolete')?.basePath,
    ).toBeNull()
  })

  test('replaces domains atomically, preserves verification and rejects hostname ownership conflicts', async () => {
    const verifiedAt = new Date()
    await main
      .update(schema.domains)
      .set({ status: 'active', message: 'Verified', verifiedAt })
      .where(eq(schema.domains.id, 'route-default'))
    const now = new Date()
    const kept = {
      host: 'default-route.example.com',
      environmentId: 'enqueue-environment',
      basePath: '/',
      https: true,
    }
    await replaceProjectDomains(main, {
      projectId: 'enqueue-project',
      domains: [kept],
      now,
    })
    expect(
      (
        await main
          .select()
          .from(schema.domains)
          .where(eq(schema.domains.id, 'route-default'))
      )[0],
    ).toMatchObject({ status: 'active', message: 'Verified', verifiedAt })
    await main.batch([
      main.insert(schema.projects).values({
        id: 'foreign-domain-project',
        teamId: 'enqueue-team',
        name: 'foreign-domain-project',
        slug: 'foreign-domain-project',
        githubRepo: 'example/foreign',
      }),
      main.insert(schema.environments).values({
        id: 'foreign-domain-environment',
        projectId: 'foreign-domain-project',
        name: 'Production',
        slug: 'production',
        branch: 'main',
        runtimeId: 'foreign-domain-runtime',
      }),
      main.insert(schema.domains).values({
        id: 'foreign-domain',
        projectId: 'foreign-domain-project',
        environmentId: 'foreign-domain-environment',
        hostname: 'owned.example.com',
      }),
      main.insert(schema.aliases).values({
        id: 'reserved-alias',
        projectId: 'enqueue-project',
        environmentId: 'enqueue-environment',
        hostname: 'reserved.example.com',
        type: 'environment',
      }),
      main.insert(schema.environments).values({
        id: 'enqueue-staging',
        projectId: 'enqueue-project',
        name: 'Staging',
        slug: 'staging',
        branch: 'staging',
        runtimeId: 'enqueue-staging',
      }),
    ])
    await expect(
      replaceProjectDomains(main, {
        projectId: 'enqueue-project',
        domains: [kept, { ...kept, host: 'reserved.example.com' }],
        now,
      }),
    ).rejects.toThrow()
    const partial = [
      kept,
      ...Array.from({ length: 5 }, (_, index) => ({
        ...kept,
        host: `new-${index}.example.com`,
      })),
      { ...kept, host: 'owned.example.com' },
    ]
    await expect(
      replaceProjectDomains(main, {
        projectId: 'enqueue-project',
        domains: partial,
        now,
      }),
    ).rejects.toThrow()
    expect(
      await main
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.projectId, 'enqueue-project')),
    ).toHaveLength(1)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.domains)
            .where(eq(schema.domains.id, 'foreign-domain'))
        )[0],
      ).projectId,
    ).toBe('foreign-domain-project')
    await replaceProjectDomains(main, {
      projectId: 'enqueue-project',
      domains: [{ ...kept, environmentId: 'enqueue-staging' }],
      now,
    })
    expect(
      (
        await main
          .select()
          .from(schema.domains)
          .where(eq(schema.domains.id, 'route-default'))
      )[0],
    ).toMatchObject({
      status: 'pending',
      message: null,
      verifiedAt: null,
      environmentId: 'enqueue-staging',
    })
    await replaceProjectDomains(main, {
      projectId: 'enqueue-project',
      domains: [],
      now,
    })
    expect(
      await main
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.projectId, 'enqueue-project')),
    ).toEqual([])
  })

  test('deployment enqueueing rolls back cancellation and deduplicates deliveries without repeated effects', async () => {
    const now = new Date()
    const source = {
      id: 'enqueue-old-deployment',
      environmentId: 'enqueue-environment',
      serverId: 'enqueue-server',
      trigger: 'webhook' as const,
      repoId: 1,
      repoFullName: 'example/project',
      gitSha: 'sha',
      gitBranch: 'main',
      commitMeta: {},
      config: {},
      envVars: '[]',
      runtimeId: 'enqueue-runtime',
    }
    await main
      .insert(schema.deployments)
      .values({ ...source, status: 'running' })
    const input = {
      deployment: {
        ...source,
        id: 'enqueue-new-deployment',
        githubDeliveryId: 'delivery-atomic',
      },
      projectId: 'enqueue-project',
      hostname: 'enqueue-new.example.com',
      branchHostname: 'enqueue-branch.example.com',
      https: true,
      queuedMessage: 'Queued new deployment.',
      canceledMessage: 'Canceled by newer deployment.',
      now,
    }
    await main.run(sql`create trigger reject_deployment_alias before insert on aliases
      when new.hostname = 'enqueue-new.example.com' begin select raise(abort, 'simulated alias failure'); end`)
    try {
      await expect(enqueueDeployment(main, input)).rejects.toThrow(
        'simulated alias failure',
      )
      expect(
        await main
          .select()
          .from(schema.deployments)
          .where(eq(schema.deployments.id, input.deployment.id)),
      ).toEqual([])
      expect(
        required(
          (
            await main
              .select()
              .from(schema.deployments)
              .where(eq(schema.deployments.id, source.id))
          )[0],
        ).status,
      ).toBe('running')
      expect(
        await main
          .select()
          .from(schema.deploymentEvents)
          .where(eq(schema.deploymentEvents.deploymentId, source.id)),
      ).toEqual([])
      expect(
        await main
          .select()
          .from(schema.aliases)
          .where(eq(schema.aliases.hostname, input.branchHostname)),
      ).toEqual([])
    } finally {
      await main.run(sql`drop trigger reject_deployment_alias`)
    }
    const blocked = {
      ...input,
      deployment: {
        ...input.deployment,
        id: 'enqueue-blocked',
        githubDeliveryId: 'delivery-blocked',
      },
      failureMessage: 'Assigned server is disconnected.',
      queuedMessage: 'Assigned server is disconnected.',
    }
    expect(await enqueueDeployment(main, blocked)).toBe(true)
    expect(
      await enqueueDeployment(main, {
        ...blocked,
        deployment: { ...blocked.deployment, id: 'enqueue-blocked-retry' },
      }),
    ).toBe(false)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.deployments)
            .where(eq(schema.deployments.id, source.id))
        )[0],
      ).status,
    ).toBe('running')
    expect(
      required(
        (
          await main
            .select()
            .from(schema.deployments)
            .where(eq(schema.deployments.id, blocked.deployment.id))
        )[0],
      ),
    ).toMatchObject({
      status: 'failed',
      errorMessage: blocked.failureMessage,
      finishedAt: now,
    })
    expect(
      await main
        .select()
        .from(schema.aliases)
        .where(eq(schema.aliases.deploymentId, blocked.deployment.id)),
    ).toEqual([])
    const results = await Promise.all([
      enqueueDeployment(main, input),
      enqueueDeployment(main, {
        ...input,
        deployment: { ...input.deployment, id: 'enqueue-duplicate' },
        hostname: 'enqueue-duplicate.example.com',
      }),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.deployments)
            .where(eq(schema.deployments.id, source.id))
        )[0],
      ).status,
    ).toBe('canceled')
    expect(
      await main
        .select()
        .from(schema.deploymentEvents)
        .where(eq(schema.deploymentEvents.deploymentId, source.id)),
    ).toHaveLength(1)
    const [winner] = await main
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.githubDeliveryId, 'delivery-atomic'))
    await main
      .insert(schema.deployments)
      .values({ ...source, id: 'enqueue-later', status: 'queued' })
    expect(
      await enqueueDeployment(main, {
        ...input,
        deployment: { ...input.deployment, id: 'enqueue-replay' },
      }),
    ).toBe(false)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.deployments)
            .where(eq(schema.deployments.id, 'enqueue-later'))
        )[0],
      ).status,
    ).toBe('queued')
    await expect(
      enqueueDeployment(main, {
        ...input,
        deployment: { ...input.deployment, id: required(winner).id },
      }),
    ).rejects.toThrow()
    expect(
      required(
        (
          await main
            .select()
            .from(schema.deployments)
            .where(eq(schema.deployments.id, 'enqueue-later'))
        )[0],
      ).status,
    ).toBe('queued')
    await main.insert(schema.domains).values({
      id: 'enqueue-reserved-domain',
      projectId: input.projectId,
      environmentId: source.environmentId,
      hostname: 'reserved-enqueue.example.com',
    })
    await expect(
      enqueueDeployment(main, {
        ...input,
        hostname: 'reserved-enqueue.example.com',
        deployment: { ...source, id: 'enqueue-domain-collision' },
      }),
    ).rejects.toThrow()
    expect(
      required(
        (
          await main
            .select()
            .from(schema.deployments)
            .where(eq(schema.deployments.id, 'enqueue-later'))
        )[0],
      ).status,
    ).toBe('queued')
    expect(
      await main
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.id, 'enqueue-domain-collision')),
    ).toEqual([])
  })

  test('project creation rolls back environments and names when its alias cannot be stored', async () => {
    await main
      .insert(schema.teams)
      .values({ id: 'creation-team', name: 'Creation', slug: 'creation-team' })
    const makeInput = (id: string) => ({
      project: {
        id,
        teamId: 'creation-team',
        name: 'created-project',
        slug: 'created-project',
        githubRepo: 'example/project',
      },
      environment: {
        id: `${id}-production`,
        projectId: id,
        name: 'Production',
        slug: 'production',
        branch: 'main',
        isProduction: true,
        runtimeId: `${id}-runtime`,
      },
      hostname: `${id}.example.com`,
      https: true,
    })
    await main.run(sql`create trigger reject_creation_alias before insert on aliases
      when new.project_id = 'creation-failed' begin select raise(abort, 'simulated creation failure'); end`)
    try {
      await expect(
        insertProject(main, makeInput('creation-failed')),
      ).rejects.toThrow('simulated creation failure')
      expect(
        await main
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, 'creation-failed')),
      ).toEqual([])
      expect(
        await main
          .select()
          .from(schema.environments)
          .where(eq(schema.environments.projectId, 'creation-failed')),
      ).toEqual([])
    } finally {
      await main.run(sql`drop trigger reject_creation_alias`)
    }
    const results = await Promise.allSettled(
      ['creation-a', 'creation-b'].map((id) =>
        insertProject(main, makeInput(id)),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const [created] = await main
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.teamId, 'creation-team'))
    expect(
      await main
        .select()
        .from(schema.environments)
        .where(eq(schema.environments.projectId, required(created).id)),
    ).toHaveLength(1)
    expect(
      await main
        .select()
        .from(schema.aliases)
        .where(eq(schema.aliases.projectId, required(created).id)),
    ).toHaveLength(1)
  })

  test('environment replacement preserves IDs, rejects stale snapshots and rolls back the whole replacement', async () => {
    const [project] = await main
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.teamId, 'creation-team'))
    const [production] = await main
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.projectId, required(project).id))
    const oldId = 'creation-old-environment'
    await main.insert(schema.environments).values({
      id: oldId,
      projectId: required(project).id,
      name: 'Old',
      slug: 'old',
      branch: 'old-*',
      runtimeId: 'old-runtime',
    })
    await main.insert(schema.domains).values({
      id: 'creation-old-domain',
      projectId: required(project).id,
      environmentId: oldId,
      hostname: 'creation-old.example.com',
    })
    await main.insert(schema.aliases).values({
      id: 'creation-old-alias',
      projectId: required(project).id,
      environmentId: oldId,
      hostname: 'creation-old-alias.example.com',
      type: 'environment',
    })
    await main
      .update(schema.projects)
      .set({
        routes: [
          { path: '/', service: 'web', port: 3000 },
          { path: '/old', service: 'web', port: 3000, environmentId: oldId },
        ],
      })
      .where(eq(schema.projects.id, required(project).id))
    const previousEnvironments = await main
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.projectId, required(project).id))
    const previousAliases = await main
      .select()
      .from(schema.aliases)
      .where(eq(schema.aliases.projectId, required(project).id))
    const productionAlias = previousAliases.find(
      (a) => a.environmentId === required(production).id,
    )!
    const now = new Date(Date.now() + 100)
    const input = {
      projectId: required(project).id,
      previousDefaultServerId: null,
      previousEnvironments,
      previousAliases,
      now,
      environments: [
        {
          id: required(production).id,
          name: 'Production',
          slug: 'production',
          branch: 'main',
          serverId: null,
          color: 'blue',
          position: 0,
          isProduction: true,
          runtimeId: 'must-preserve-original-runtime',
          alias: {
            id: productionAlias.id,
            hostname: productionAlias.hostname,
            https: false,
          },
        },
        {
          id: 'creation-new-environment',
          name: 'Staging',
          slug: 'staging',
          branch: 'staging-*',
          serverId: null,
          color: 'violet',
          position: 1,
          isProduction: false,
          runtimeId: 'new-runtime',
          alias: {
            id: 'creation-new-alias',
            hostname: 'creation-new.example.com',
            https: true,
          },
        },
      ],
    }
    await main.run(sql`create trigger reject_environment_routes before update of routes on projects
      when new.team_id = 'creation-team' begin select raise(abort, 'simulated environment failure'); end`)
    try {
      await expect(replaceProjectEnvironments(main, input)).rejects.toThrow(
        'simulated environment failure',
      )
      expect(
        await main
          .select()
          .from(schema.environments)
          .where(eq(schema.environments.projectId, required(project).id)),
      ).toEqual(previousEnvironments)
      expect(
        await main
          .select()
          .from(schema.aliases)
          .where(eq(schema.aliases.projectId, required(project).id)),
      ).toEqual(previousAliases)
      expect(
        await main
          .select()
          .from(schema.domains)
          .where(eq(schema.domains.id, 'creation-old-domain')),
      ).toHaveLength(1)
    } finally {
      await main.run(sql`drop trigger reject_environment_routes`)
    }
    const results = await Promise.allSettled([
      replaceProjectEnvironments(main, input),
      replaceProjectEnvironments(main, input),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected')
    expect(failed?.status === 'rejected' ? failed.reason : null).toBeInstanceOf(
      EnvironmentStateChanged,
    )
    expect(
      required(
        (
          await main
            .select()
            .from(schema.environments)
            .where(eq(schema.environments.id, required(production).id))
        )[0],
      ).runtimeId,
    ).toBe(required(production).runtimeId)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.aliases)
            .where(eq(schema.aliases.id, productionAlias.id))
        )[0],
      ).https,
    ).toBe(productionAlias.https)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.environments)
            .where(eq(schema.environments.id, oldId))
        )[0],
      ).status,
    ).toBe('deleted')
    expect(
      await main
        .select()
        .from(schema.aliases)
        .where(eq(schema.aliases.id, 'creation-old-alias')),
    ).toEqual([])
    expect(
      await main
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.id, 'creation-old-domain')),
    ).toEqual([])
    expect(
      required(
        (
          await main
            .select()
            .from(schema.projects)
            .where(eq(schema.projects.id, required(project).id))
        )[0],
      ).routes,
    ).toEqual([{ path: '/', service: 'web', port: 3000 }])
    expect(
      await main
        .select()
        .from(schema.aliases)
        .where(eq(schema.aliases.id, 'creation-new-alias')),
    ).toHaveLength(1)
    const currentEnvironments = await main
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.projectId, required(project).id))
    const currentAliases = await main
      .select()
      .from(schema.aliases)
      .where(eq(schema.aliases.projectId, required(project).id))
    await main
      .update(schema.aliases)
      .set({ deploymentId: null, hostname: 'creation-updated.example.com' })
      .where(eq(schema.aliases.id, productionAlias.id))
    await expect(
      replaceProjectEnvironments(main, {
        ...input,
        previousEnvironments: currentEnvironments,
        previousAliases: currentAliases,
      }),
    ).rejects.toBeInstanceOf(EnvironmentStateChanged)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.aliases)
            .where(eq(schema.aliases.id, productionAlias.id))
        )[0],
      ).hostname,
    ).toBe('creation-updated.example.com')
  })

  test('server deletion rechecks permissions and rolls back jobs and monitoring if its final update fails', async () => {
    const [project] = await main
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.teamId, 'creation-team'))
    const [environment] = await main
      .select()
      .from(schema.environments)
      .where(
        and(
          eq(schema.environments.projectId, required(project).id),
          eq(schema.environments.isProduction, true),
        ),
      )
    const now = new Date()
    await main.insert(schema.user).values({
      id: 'delete-server-manager',
      username: 'delete-server-manager',
      name: 'Manager',
      email: 'delete-server-manager@example.com',
      emailVerified: true,
    })
    await main.insert(schema.teamMembers).values({
      id: 'delete-server-membership',
      userId: 'delete-server-manager',
      teamId: 'creation-team',
      role: 'member',
    })
    await main.insert(schema.servers).values(
      ['keep-work', 'cancel-work'].map((id) => ({
        id,
        teamId: 'creation-team',
        name: id,
        handle: id,
        status: 'connected' as const,
        enrollmentTokenHash: 'pending-enrollment',
      })),
    )
    await main.insert(schema.serverMetrics).values({
      id: 'deleted-metric',
      serverId: 'keep-work',
      observedAt: now,
      cpuPercent: 20,
    })
    await main.insert(schema.serverHeartbeats).values({
      id: 'deleted-heartbeat',
      serverId: 'keep-work',
      observedAt: now,
    })
    await main
      .insert(schema.serverAvailabilityWindows)
      .values({ id: 'deleted-window', serverId: 'keep-work', startedAt: now })
    await main.insert(schema.agentJobs).values(
      ['keep-work', 'cancel-work'].flatMap((serverId) =>
        ['backup', 'deploy'].map((type) => ({
          id: `${serverId}-${type}`,
          serverId,
          type: type as 'backup' | 'deploy',
          payload: {},
          status: 'running' as const,
        })),
      ),
    )
    await main.insert(schema.backupRuns).values({
      id: 'deleted-backup',
      projectId: required(project).id,
      environmentId: required(environment).id,
      serverId: 'keep-work',
      runtimeId: 'keep-work',
      status: 'running',
    })
    await main.insert(schema.deployments).values(
      ['keep-work', 'cancel-work'].map((serverId) => ({
        id: `${serverId}-deployment`,
        environmentId: required(environment).id,
        serverId,
        status: 'running' as const,
        repoId: 1,
        repoFullName: 'example/project',
        gitSha: 'sha',
        gitBranch: 'main',
        config: {},
        envVars: '[]',
        runtimeId: serverId,
      })),
    )
    const input = {
      userId: 'delete-server-manager',
      teamId: 'creation-team',
      serverId: 'keep-work',
      cancelOngoingDeployments: false,
      now,
    }
    expect(await deleteServerState(main, input)).toBe(false)
    expect(
      await main
        .select()
        .from(schema.serverMetrics)
        .where(eq(schema.serverMetrics.serverId, 'keep-work')),
    ).toHaveLength(1)
    await main
      .update(schema.teamMembers)
      .set({ role: 'owner' })
      .where(eq(schema.teamMembers.id, 'delete-server-membership'))
    await main.run(sql`create trigger reject_deleted_server before update of status on servers
      when new.id = 'keep-work' and new.status = 'deleted' begin select raise(abort, 'simulated deletion failure'); end`)
    try {
      await expect(deleteServerState(main, input)).rejects.toThrow(
        'simulated deletion failure',
      )
      expect(
        required(
          (
            await main
              .select()
              .from(schema.agentJobs)
              .where(eq(schema.agentJobs.id, 'keep-work-backup'))
          )[0],
        ).status,
      ).toBe('running')
      expect(
        required(
          (
            await main
              .select()
              .from(schema.backupRuns)
              .where(eq(schema.backupRuns.id, 'deleted-backup'))
          )[0],
        ).status,
      ).toBe('running')
      expect(
        await main
          .select()
          .from(schema.serverMetrics)
          .where(eq(schema.serverMetrics.serverId, 'keep-work')),
      ).toHaveLength(1)
      expect(
        await main
          .select()
          .from(schema.serverHeartbeats)
          .where(eq(schema.serverHeartbeats.serverId, 'keep-work')),
      ).toHaveLength(1)
      expect(
        required(
          (
            await main
              .select()
              .from(schema.serverAvailabilityWindows)
              .where(eq(schema.serverAvailabilityWindows.id, 'deleted-window'))
          )[0],
        ).endedAt,
      ).toBeNull()
    } finally {
      await main.run(sql`drop trigger reject_deleted_server`)
    }
    expect(await deleteServerState(main, input)).toBe(true)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.agentJobs)
            .where(eq(schema.agentJobs.id, 'keep-work-backup'))
        )[0],
      ).status,
    ).toBe('canceled')
    expect(
      required(
        (
          await main
            .select()
            .from(schema.agentJobs)
            .where(eq(schema.agentJobs.id, 'keep-work-deploy'))
        )[0],
      ).status,
    ).toBe('running')
    expect(
      required(
        (
          await main
            .select()
            .from(schema.deployments)
            .where(eq(schema.deployments.id, 'keep-work-deployment'))
        )[0],
      ).status,
    ).toBe('running')
    expect(
      required(
        (
          await main
            .select()
            .from(schema.servers)
            .where(eq(schema.servers.id, 'keep-work'))
        )[0],
      ).enrollmentTokenHash,
    ).toBe('pending-enrollment')
    expect(
      await main
        .select()
        .from(schema.serverMetrics)
        .where(eq(schema.serverMetrics.serverId, 'keep-work')),
    ).toEqual([])
    expect(
      await main
        .select()
        .from(schema.serverHeartbeats)
        .where(eq(schema.serverHeartbeats.serverId, 'keep-work')),
    ).toEqual([])
    expect(
      required(
        (
          await main
            .select()
            .from(schema.serverAvailabilityWindows)
            .where(eq(schema.serverAvailabilityWindows.id, 'deleted-window'))
        )[0],
      ).endedAt,
    ).toEqual(now)
    expect(
      await deleteServerState(main, {
        ...input,
        serverId: 'cancel-work',
        cancelOngoingDeployments: true,
      }),
    ).toBe(true)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.agentJobs)
            .where(eq(schema.agentJobs.id, 'cancel-work-deploy'))
        )[0],
      ).status,
    ).toBe('canceled')
    expect(
      required(
        (
          await main
            .select()
            .from(schema.deployments)
            .where(eq(schema.deployments.id, 'cancel-work-deployment'))
        )[0],
      ).status,
    ).toBe('canceled')
    expect(
      required(
        (
          await main
            .select()
            .from(schema.servers)
            .where(eq(schema.servers.id, 'cancel-work'))
        )[0],
      ).enrollmentTokenHash,
    ).toBeNull()
    expect(await deleteServerState(main, input)).toBe(false)
  })

  test('claims deployments atomically while serializing only jobs sharing a runtime', async () => {
    await main.batch([
      main
        .insert(schema.teams)
        .values({ id: 'queue-team', name: 'Queue', slug: 'queue-team' }),
      main.insert(schema.servers).values({
        id: 'queue-server',
        teamId: 'queue-team',
        name: 'Queue',
        handle: 'queue',
      }),
      main.insert(schema.projects).values({
        id: 'queue-project',
        teamId: 'queue-team',
        name: 'queue-project',
        slug: 'queue-project',
        githubRepo: 'example/project',
      }),
      main.insert(schema.environments).values({
        id: 'queue-environment',
        projectId: 'queue-project',
        name: 'Production',
        slug: 'production',
        branch: 'main',
        runtimeId: 'queue-runtime',
      }),
      main.insert(schema.deployments).values(
        ['queue-a', 'queue-b', 'queue-c'].map((id, index) => ({
          id,
          environmentId: 'queue-environment',
          serverId: 'queue-server',
          status: 'queued' as const,
          repoId: 1,
          repoFullName: 'example/project',
          gitSha: 'sha',
          gitBranch: 'main',
          config: {},
          envVars: '[]',
          runtimeId: index < 2 ? 'shared-runtime' : 'independent-runtime',
          createdAt: new Date(index + 1),
        })),
      ),
    ])
    const claimed = await Promise.all(
      Array.from({ length: 3 }, () =>
        claimDeployment(main, 'queue-server', new Date()),
      ),
    )
    expect(claimed.flatMap((row) => (row ? [row.id] : [])).sort()).toEqual([
      'queue-a',
      'queue-c',
    ])
    expect(await claimDeployment(main, 'queue-server', new Date())).toBeNull()
    await main
      .update(schema.deployments)
      .set({ status: 'succeeded' })
      .where(eq(schema.deployments.id, 'queue-a'))
    expect((await claimDeployment(main, 'queue-server', new Date()))?.id).toBe(
      'queue-b',
    )
    expect(await claimDeployment(main, 'unknown-server', new Date())).toBeNull()
  })

  test('cleanup claims increment attempts once and skip unavailable or unrelated job types', async () => {
    const now = new Date()
    await main.insert(schema.agentJobs).values([
      {
        id: 'cleanup-a',
        type: 'deprovision',
        serverId: 'queue-server',
        payload: {},
        createdAt: new Date(1),
        availableAt: now,
      },
      {
        id: 'cleanup-b',
        type: 'purge',
        serverId: 'queue-server',
        payload: {},
        createdAt: new Date(2),
        availableAt: now,
        attempt: 2,
      },
      {
        id: 'future-cleanup',
        type: 'purge',
        serverId: 'queue-server',
        payload: {},
        availableAt: new Date(now.getTime() + 60_000),
      },
      {
        id: 'backup-ignored',
        type: 'backup',
        serverId: 'queue-server',
        payload: {},
        availableAt: now,
      },
    ])
    const results = await Promise.all(
      Array.from({ length: 3 }, () => claimCleanup(main, 'queue-server', now)),
    )
    expect(results.flatMap((row) => (row ? [row.id] : [])).sort()).toEqual([
      'cleanup-a',
      'cleanup-b',
    ])
    expect(results.find((row) => row?.id === 'cleanup-a')?.attempt).toBe(1)
    expect(results.find((row) => row?.id === 'cleanup-b')?.attempt).toBe(3)
    expect(await claimCleanup(main, 'queue-server', now)).toBeNull()
  })

  test('claims a backup and its run together, with rollback and stale-candidate guards', async () => {
    const now = new Date()
    await main.batch([
      main.insert(schema.backupRuns).values({
        id: 'claimed-backup',
        projectId: 'queue-project',
        environmentId: 'queue-environment',
        serverId: 'queue-server',
        runtimeId: 'queue-runtime',
        status: 'queued',
      }),
      main.insert(schema.agentJobs).values({
        id: 'claimed-backup-job',
        type: 'backup',
        serverId: 'queue-server',
        payload: { backupRunId: 'claimed-backup' },
        availableAt: now,
      }),
    ])
    const [job] = await main
      .select()
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.id, 'claimed-backup-job'))
    const input = {
      job: required(job),
      payloadSnapshot: JSON.stringify(required(job).payload),
      backupRunId: 'claimed-backup',
      now,
    }
    await main
      .update(schema.agentJobs)
      .set({ payload: { backupRunId: 'different-backup' } })
      .where(eq(schema.agentJobs.id, required(job).id))
    expect(await claimBackupCandidate(main, input)).toBeNull()
    expect(
      required(
        (
          await main
            .select()
            .from(schema.backupRuns)
            .where(eq(schema.backupRuns.id, 'claimed-backup'))
        )[0],
      ).status,
    ).toBe('queued')
    await main
      .update(schema.agentJobs)
      .set({ payload: required(job).payload })
      .where(eq(schema.agentJobs.id, required(job).id))
    await main.run(sql`create trigger reject_backup_claim before update of status on agent_jobs
      when new.id = 'claimed-backup-job' and new.status = 'running' begin select raise(abort, 'simulated claim failure'); end`)
    try {
      await expect(claimBackupCandidate(main, input)).rejects.toThrow(
        'simulated claim failure',
      )
      expect(
        required(
          (
            await main
              .select()
              .from(schema.backupRuns)
              .where(eq(schema.backupRuns.id, 'claimed-backup'))
          )[0],
        ).status,
      ).toBe('queued')
    } finally {
      await main.run(sql`drop trigger reject_backup_claim`)
    }
    const results = await Promise.all([
      claimBackupCandidate(main, input),
      claimBackupCandidate(main, input),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.find(Boolean)?.attempt).toBe(1)
    const [run] = await main
      .select()
      .from(schema.backupRuns)
      .where(eq(schema.backupRuns.id, 'claimed-backup'))
    expect(run).toMatchObject({ status: 'running', startedAt: now })
  })

  test('claims and expires SQL-built JSON jobs without reserializing their payload snapshot', async () => {
    const now = new Date()
    await main.run(sql`insert into agent_jobs(id,type,server_id,status,payload,available_at)
      values ('sql-json-claim','backup_cleanup','queue-server','queued',json_object('schemaVersion',1.0,'backupRunIds',json('[]'),'localObjectKeys',json('[]'),'remoteObjectKeys',json('[]'),'destination',json('{}')),${now.getTime()})`)
    const [snapshot] = await main
      .select({
        job: schema.agentJobs,
        payloadSnapshot: sql<string>`${schema.agentJobs.payload}`,
      })
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.id, 'sql-json-claim'))
    expect(required(snapshot).payloadSnapshot).not.toBe(
      JSON.stringify(required(snapshot).job.payload),
    )
    expect(
      await claimBackupCandidate(main, {
        ...required(snapshot),
        backupRunId: null,
        now,
      }),
    ).not.toBeNull()
    await main
      .update(schema.agentJobs)
      .set({ claimedAt: new Date(1) })
      .where(eq(schema.agentJobs.id, 'sql-json-claim'))
    const [running] = await main
      .select({
        job: schema.agentJobs,
        payloadSnapshot: sql<string>`${schema.agentJobs.payload}`,
      })
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.id, 'sql-json-claim'))
    expect(
      await failStaleAgentJob(main, {
        ...required(running),
        now,
        timeoutMs: 1000,
        message: 'Timed out',
        backupRunId: null,
        cleanupRunIds: [],
      }),
    ).toBe(true)
  })

  test('completes backup artifacts and statuses atomically across bounded inserts and terminal replays', async () => {
    const input = {
      serverId: 'queue-server',
      now: new Date(),
      errorMessage: null,
      manifest: { version: 1, names: ['data'] },
      completion: {
        jobId: 'claimed-backup-job',
        backupRunId: 'claimed-backup',
        status: 'succeeded' as const,
        artifacts: Array.from({ length: 20 }, (_, index) => ({
          type: 'volume' as const,
          storage: 'local' as const,
          objectKey: `/backups/artifact-${index}`,
          checksumSha256: 'a'.repeat(64),
          sizeBytes: index + 1,
        })),
      },
    }
    await main.run(sql`create trigger reject_backup_finish before update of status on agent_jobs
      when new.id = 'claimed-backup-job' and new.status = 'succeeded' begin select raise(abort, 'simulated backup failure'); end`)
    try {
      await expect(finishBackup(main, input)).rejects.toThrow(
        'simulated backup failure',
      )
      expect(
        await main
          .select()
          .from(schema.backupArtifacts)
          .where(eq(schema.backupArtifacts.backupRunId, 'claimed-backup')),
      ).toEqual([])
      expect(
        required(
          (
            await main
              .select()
              .from(schema.backupRuns)
              .where(eq(schema.backupRuns.id, 'claimed-backup'))
          )[0],
        ).status,
      ).toBe('running')
    } finally {
      await main.run(sql`drop trigger reject_backup_finish`)
    }
    expect(
      (
        await Promise.all([
          finishBackup(main, input),
          finishBackup(main, input),
        ])
      ).sort(),
    ).toEqual([false, true])
    expect(
      await main
        .select()
        .from(schema.backupArtifacts)
        .where(eq(schema.backupArtifacts.backupRunId, 'claimed-backup')),
    ).toHaveLength(20)
    const [run] = await main
      .select()
      .from(schema.backupRuns)
      .where(eq(schema.backupRuns.id, 'claimed-backup'))
    expect(run).toMatchObject({ status: 'succeeded', manifest: input.manifest })
    expect(
      await finishBackup(main, {
        ...input,
        completion: {
          ...input.completion,
          artifacts: [
            {
              ...required(input.completion.artifacts[0]),
              objectKey: '/backups/late',
            },
          ],
        },
      }),
    ).toBe(false)
    expect(
      await main
        .select()
        .from(schema.backupArtifacts)
        .where(eq(schema.backupArtifacts.backupRunId, 'claimed-backup')),
    ).toHaveLength(20)
  })

  test('rolls cleanup deletion back on failure and cannot clear a later cleanup request on replay', async () => {
    await main.batch([
      main.insert(schema.agentJobs).values({
        id: 'finish-cleanup-job',
        type: 'backup_cleanup',
        serverId: 'queue-server',
        status: 'running',
        payload: {},
      }),
      main
        .update(schema.backupRuns)
        .set({ cleanupQueuedAt: new Date() })
        .where(eq(schema.backupRuns.id, 'claimed-backup')),
    ])
    const input = {
      serverId: 'queue-server',
      now: new Date(),
      errorMessage: null,
      completion: {
        jobId: 'finish-cleanup-job',
        backupRunIds: ['claimed-backup'],
        status: 'succeeded' as const,
      },
      backupRunIds: ['claimed-backup'],
      localObjectKeys: Array.from(
        { length: 20 },
        (_, index) => `/backups/artifact-${index}`,
      ),
      remoteObjectKeys: [],
    }
    await main.run(sql`create trigger reject_cleanup_finish before update of status on agent_jobs
      when new.id = 'finish-cleanup-job' and new.status = 'succeeded' begin select raise(abort, 'simulated cleanup failure'); end`)
    try {
      await expect(finishBackupCleanup(main, input)).rejects.toThrow(
        'simulated cleanup failure',
      )
      expect(
        await main
          .select()
          .from(schema.backupArtifacts)
          .where(eq(schema.backupArtifacts.backupRunId, 'claimed-backup')),
      ).toHaveLength(20)
      expect(
        required(
          (
            await main
              .select()
              .from(schema.backupRuns)
              .where(eq(schema.backupRuns.id, 'claimed-backup'))
          )[0],
        ).cleanupQueuedAt,
      ).not.toBeNull()
    } finally {
      await main.run(sql`drop trigger reject_cleanup_finish`)
    }
    expect(await finishBackupCleanup(main, input)).toBe(true)
    expect(
      await main
        .select()
        .from(schema.backupArtifacts)
        .where(eq(schema.backupArtifacts.backupRunId, 'claimed-backup')),
    ).toEqual([])
    const later = new Date(input.now.getTime() + 1000)
    await main
      .update(schema.backupRuns)
      .set({ cleanupQueuedAt: later })
      .where(eq(schema.backupRuns.id, 'claimed-backup'))
    expect(await finishBackupCleanup(main, input)).toBe(false)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.backupRuns)
            .where(eq(schema.backupRuns.id, 'claimed-backup'))
        )[0],
      ).cleanupQueuedAt,
    ).toEqual(later)
  })

  test('stale job cleanup rechecks the claim time and rolls back related run changes', async () => {
    const now = new Date()
    const old = new Date(now.getTime() - 30 * 60 * 60 * 1000)
    await main.insert(schema.agentJobs).values({
      id: 'stale-job',
      type: 'backup_cleanup',
      serverId: 'queue-server',
      status: 'running',
      claimedAt: old,
      payload: { backupRunIds: ['claimed-backup'] },
    })
    const [job] = await main
      .select()
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.id, 'stale-job'))
    const input = {
      job: required(job),
      payloadSnapshot: JSON.stringify(required(job).payload),
      now,
      timeoutMs: 25 * 60 * 60 * 1000,
      message: 'Timed out',
      backupRunId: null,
      cleanupRunIds: ['claimed-backup'],
    }
    await main
      .update(schema.agentJobs)
      .set({ claimedAt: now })
      .where(eq(schema.agentJobs.id, required(job).id))
    expect(await failStaleAgentJob(main, input)).toBe(false)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.backupRuns)
            .where(eq(schema.backupRuns.id, 'claimed-backup'))
        )[0],
      ).cleanupQueuedAt,
    ).not.toBeNull()
    await main
      .update(schema.agentJobs)
      .set({ claimedAt: old })
      .where(eq(schema.agentJobs.id, required(job).id))
    await main.run(sql`create trigger reject_timeout before update of status on agent_jobs
      when new.id = 'stale-job' and new.status = 'failed' begin select raise(abort, 'simulated timeout failure'); end`)
    try {
      await expect(failStaleAgentJob(main, input)).rejects.toThrow(
        'simulated timeout failure',
      )
      expect(
        required(
          (
            await main
              .select()
              .from(schema.backupRuns)
              .where(eq(schema.backupRuns.id, 'claimed-backup'))
          )[0],
        ).cleanupQueuedAt,
      ).not.toBeNull()
    } finally {
      await main.run(sql`drop trigger reject_timeout`)
    }
    expect(
      (
        await Promise.all([
          failStaleAgentJob(main, input),
          failStaleAgentJob(main, input),
        ])
      ).sort(),
    ).toEqual([false, true])
    expect(
      required(
        (
          await main
            .select()
            .from(schema.backupRuns)
            .where(eq(schema.backupRuns.id, 'claimed-backup'))
        )[0],
      ).cleanupQueuedAt,
    ).toBeNull()
    await main
      .update(schema.backupRuns)
      .set({ cleanupQueuedAt: now })
      .where(eq(schema.backupRuns.id, 'claimed-backup'))
    expect(await failStaleAgentJob(main, input)).toBe(false)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.backupRuns)
            .where(eq(schema.backupRuns.id, 'claimed-backup'))
        )[0],
      ).cleanupQueuedAt,
    ).toEqual(now)
  })

  test('reconciles 200 runtimes with guarded cleanup, preserved service state and atomic rollback', async () => {
    const now = new Date()
    await main
      .update(schema.environments)
      .set({ runtimeId: 'dp_active', serverId: 'queue-server' })
      .where(eq(schema.environments.id, 'queue-environment'))
    const runtimeIds = [
      'dp_active',
      ...Array.from(
        { length: 199 },
        (_, index) => `dp_orphan_${index.toString().padStart(3, '0')}`,
      ),
    ]
    const services = [
      {
        name: 'web',
        containerName: 'web-1',
        state: 'running',
        health: 'healthy',
        restartCount: 0,
        startedAt: null,
        exitCode: 0,
      },
    ]
    const input = {
      serverId: 'queue-server',
      runtimeIds,
      runtimes: [{ runtimeId: 'dp_orphan_000', services }],
      now,
    }
    expect(await reconcileRuntimeState(main, input)).toEqual([])
    const observed = await main
      .select()
      .from(schema.agentRuntimeObservations)
      .where(eq(schema.agentRuntimeObservations.serverId, input.serverId))
    expect(observed).toHaveLength(200)
    expect(
      observed.find((row) => row.runtimeId === 'dp_orphan_000')?.services,
    ).toEqual(services)
    const later = {
      ...input,
      runtimes: [],
      now: new Date(now.getTime() + 11 * 60_000),
    }
    await main.run(sql`create trigger reject_observation_cleanup before update of cleanup_queued_at on agent_runtime_observations
      when new.server_id = 'queue-server' and new.cleanup_queued_at is not null begin select raise(abort, 'simulated reconciliation failure'); end`)
    try {
      await expect(reconcileRuntimeState(main, later)).rejects.toThrow(
        'simulated reconciliation failure',
      )
      const jobs = await main
        .select()
        .from(schema.agentJobs)
        .where(
          and(
            eq(schema.agentJobs.serverId, input.serverId),
            eq(schema.agentJobs.type, 'deprovision'),
          ),
        )
      expect(jobs).toHaveLength(1)
      expect(
        required(
          (
            await main
              .select()
              .from(schema.agentRuntimeObservations)
              .where(
                eq(schema.agentRuntimeObservations.runtimeId, 'dp_orphan_000'),
              )
          )[0],
        ).lastSeenAt,
      ).toEqual(now)
    } finally {
      await main.run(sql`drop trigger reject_observation_cleanup`)
    }
    const results = await Promise.all([
      reconcileRuntimeState(main, later),
      reconcileRuntimeState(main, later),
    ])
    expect(results.flat().sort()).toEqual(runtimeIds.slice(1))
    expect(
      required(
        (
          await main
            .select()
            .from(schema.agentRuntimeObservations)
            .where(
              eq(schema.agentRuntimeObservations.runtimeId, 'dp_orphan_000'),
            )
        )[0],
      ).services,
    ).toEqual(services)
    const jobs = await main
      .select()
      .from(schema.agentJobs)
      .where(
        and(
          eq(schema.agentJobs.serverId, input.serverId),
          eq(schema.agentJobs.type, 'deprovision'),
          eq(schema.agentJobs.status, 'queued'),
        ),
      )
    expect(jobs).toHaveLength(1)
    expect(required(jobs[0]).payload).toMatchObject({
      schemaVersion: 1,
      removeVolumes: false,
      runtimeIds: runtimeIds.slice(1),
    })
    await main
      .update(schema.agentJobs)
      .set({ status: 'succeeded' })
      .where(eq(schema.agentJobs.id, required(jobs[0]).id))
    const purged = await reconcileRuntimeState(main, {
      ...input,
      runtimeIds: [],
      runtimes: [],
      now: new Date(later.now.getTime() + 8 * 24 * 60 * 60_000),
    })
    expect(purged.sort()).toEqual(runtimeIds.slice(1))
    const purges = await main
      .select()
      .from(schema.agentJobs)
      .where(
        and(
          eq(schema.agentJobs.serverId, input.serverId),
          eq(schema.agentJobs.type, 'purge'),
          eq(schema.agentJobs.status, 'queued'),
        ),
      )
    expect(purges).toHaveLength(2)
    expect(
      purges.find(
        (job) =>
          (job.payload as { removeVolumes?: boolean }).removeVolumes === true,
      )?.payload,
    ).toMatchObject({ runtimeIds: runtimeIds.slice(1), removeVolumes: true })
  })

  test('completes deployment status and aliases atomically without moving aliases on replay or cancellation', async () => {
    await main.insert(schema.aliases).values([
      {
        id: 'completion-environment',
        hostname: 'environment.example.com',
        projectId: 'queue-project',
        environmentId: 'queue-environment',
        type: 'environment',
        deploymentId: 'queue-a',
      },
      {
        id: 'completion-main',
        hostname: 'main.example.com',
        projectId: 'queue-project',
        environmentId: 'queue-environment',
        type: 'branch',
        branch: 'main',
        deploymentId: 'queue-a',
      },
      {
        id: 'completion-other',
        hostname: 'other.example.com',
        projectId: 'queue-project',
        environmentId: 'queue-environment',
        type: 'branch',
        branch: 'other',
        deploymentId: 'queue-a',
      },
    ])
    const [deployment] = await main
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.id, 'queue-b'))
    const input = {
      deployment: required(deployment),
      projectId: 'queue-project',
      status: 'succeeded' as const,
      phase: 'completed',
      gitSha: 'finished-sha',
      errorMessage: null,
      now: new Date(),
    }
    await main.run(sql`create trigger reject_completion before update of status on deployments
      when new.id = 'queue-b' and new.status = 'succeeded' begin select raise(abort, 'simulated completion failure'); end`)
    try {
      await expect(finishDeployment(main, input)).rejects.toThrow(
        'simulated completion failure',
      )
      const [alias] = await main
        .select()
        .from(schema.aliases)
        .where(eq(schema.aliases.id, 'completion-environment'))
      expect(alias).toMatchObject({
        deploymentId: 'queue-a',
        previousDeploymentId: null,
      })
      expect(
        required(
          (
            await main
              .select()
              .from(schema.deployments)
              .where(eq(schema.deployments.id, 'queue-b'))
          )[0],
        ).status,
      ).toBe('running')
    } finally {
      await main.run(sql`drop trigger reject_completion`)
    }
    expect(
      (
        await Promise.all([
          finishDeployment(main, input),
          finishDeployment(main, input),
        ])
      ).sort(),
    ).toEqual([false, true])
    const aliases = await main
      .select()
      .from(schema.aliases)
      .where(eq(schema.aliases.projectId, 'queue-project'))
    expect(
      aliases.find((alias) => alias.id === 'completion-environment'),
    ).toMatchObject({
      deploymentId: 'queue-b',
      previousDeploymentId: 'queue-a',
    })
    expect(
      aliases.find((alias) => alias.id === 'completion-main'),
    ).toMatchObject({
      deploymentId: 'queue-b',
      previousDeploymentId: 'queue-a',
    })
    expect(
      aliases.find((alias) => alias.id === 'completion-other'),
    ).toMatchObject({ deploymentId: 'queue-a', previousDeploymentId: null })
    const [canceled] = await main
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.id, 'queue-c'))
    await main
      .update(schema.deployments)
      .set({ status: 'canceled' })
      .where(eq(schema.deployments.id, required(canceled).id))
    expect(
      await finishDeployment(main, {
        ...input,
        deployment: required(canceled),
      }),
    ).toBe(false)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.aliases)
            .where(eq(schema.aliases.id, 'completion-environment'))
        )[0],
      ).deploymentId,
    ).toBe('queue-b')
  })

  test('stores deployment failure events atomically and only once when failure requests race', async () => {
    await main.batch([
      main
        .insert(schema.teams)
        .values({ id: 'failure-team', name: 'Failure', slug: 'failure-team' }),
      main.insert(schema.servers).values({
        id: 'failure-server',
        teamId: 'failure-team',
        name: 'Failure',
        handle: 'failure',
      }),
      main.insert(schema.projects).values({
        id: 'failure-project',
        teamId: 'failure-team',
        name: 'failure-project',
        slug: 'failure-project',
        githubRepo: 'example/project',
      }),
      main.insert(schema.environments).values({
        id: 'failure-environment',
        projectId: 'failure-project',
        name: 'Production',
        slug: 'production',
        branch: 'main',
        runtimeId: 'failure-runtime',
      }),
      main.insert(schema.deployments).values({
        id: 'failure-deployment',
        environmentId: 'failure-environment',
        serverId: 'failure-server',
        status: 'running',
        repoId: 1,
        repoFullName: 'example/project',
        gitSha: 'sha',
        gitBranch: 'main',
        config: {},
        envVars: '[]',
        runtimeId: 'failure-runtime',
        startedAt: new Date(Date.now() - 60_000),
      }),
    ])
    const input = {
      ids: ['failure-deployment'],
      message: 'DÉPLOY failed',
      phase: 'failed',
      now: new Date(),
    }
    await main.run(sql`create trigger reject_failure before update of status on deployments
      when new.id = 'failure-deployment' and new.status = 'failed' begin select raise(abort, 'simulated failure'); end`)
    try {
      await expect(failRunningDeployments(main, input)).rejects.toThrow(
        'simulated failure',
      )
      expect(
        await main
          .select()
          .from(schema.deploymentEvents)
          .where(
            eq(schema.deploymentEvents.deploymentId, 'failure-deployment'),
          ),
      ).toEqual([])
      expect(
        required(
          (
            await main
              .select()
              .from(schema.deployments)
              .where(eq(schema.deployments.id, 'failure-deployment'))
          )[0],
        ).status,
      ).toBe('running')
    } finally {
      await main.run(sql`drop trigger reject_failure`)
    }
    expect(
      await failRunningDeployments(main, {
        ...input,
        startedBefore: new Date(Date.now() - 120_000),
      }),
    ).toEqual([])
    const results = await Promise.all([
      failRunningDeployments(main, input),
      failRunningDeployments(main, input),
    ])
    expect(results.flat()).toEqual(['failure-deployment'])
    const events = await main
      .select()
      .from(schema.deploymentEvents)
      .where(eq(schema.deploymentEvents.deploymentId, 'failure-deployment'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      seq: 1,
      content: 'DÉPLOY failed',
      searchContent: 'déploy failed',
    })
    expect(await failRunningDeployments(main, input)).toEqual([])
  })

  test('changes server status and availability together, without opening duplicate windows', async () => {
    await main.batch([
      main.insert(schema.user).values({
        id: 'server-manager',
        name: 'Manager',
        username: 'manager',
        email: 'manager@example.com',
      }),
      main
        .insert(schema.teams)
        .values({ id: 'server-team', name: 'Servers', slug: 'server-team' }),
      main.insert(schema.teamMembers).values({
        id: 'manager-member',
        userId: 'server-manager',
        teamId: 'server-team',
        role: 'admin',
      }),
      main.insert(schema.servers).values({
        id: 'managed-server',
        name: 'Managed',
        handle: 'managed',
        teamId: 'server-team',
        enrollmentTokenHash: 'token',
        status: 'pending',
      }),
      main.insert(schema.serverAvailabilityWindows).values({
        id: 'original-window',
        serverId: 'managed-server',
        startedAt: new Date(),
      }),
    ])
    const input = {
      userId: 'server-manager',
      teamId: 'server-team',
      serverId: 'managed-server',
      now: new Date(),
      enabled: false,
    }
    expect(await changeServerEnabled(main, input)).toBe(true)
    const [disabled] = await main
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, input.serverId))
    expect(required(disabled).status).toBe('disabled')
    expect(required(disabled).enrollmentTokenHash).toBeNull()
    expect(
      required(
        (
          await main
            .select()
            .from(schema.serverAvailabilityWindows)
            .where(
              eq(schema.serverAvailabilityWindows.serverId, input.serverId),
            )
        )[0],
      ).endedAt,
    ).toEqual(input.now)
    await main.run(sql`create trigger reject_enable before update of status on servers
      when new.id = 'managed-server' and new.status = 'pending' begin select raise(abort, 'simulated enable failure'); end`)
    try {
      await expect(
        changeServerEnabled(main, { ...input, enabled: true }),
      ).rejects.toThrow('simulated enable failure')
      expect(
        await main
          .select()
          .from(schema.serverAvailabilityWindows)
          .where(eq(schema.serverAvailabilityWindows.serverId, input.serverId)),
      ).toHaveLength(1)
    } finally {
      await main.run(sql`drop trigger reject_enable`)
    }
    const results = await Promise.all([
      changeServerEnabled(main, { ...input, enabled: true }),
      changeServerEnabled(main, { ...input, enabled: true }),
    ])
    expect(results.sort()).toEqual([false, true])
    const windows = await main
      .select()
      .from(schema.serverAvailabilityWindows)
      .where(eq(schema.serverAvailabilityWindows.serverId, input.serverId))
    expect(windows.filter((window) => window.endedAt === null)).toHaveLength(1)
    await main
      .update(schema.teamMembers)
      .set({ role: 'member' })
      .where(eq(schema.teamMembers.id, 'manager-member'))
    expect(await changeServerEnabled(main, input)).toBe(false)
    expect(
      required(
        (
          await main
            .select()
            .from(schema.servers)
            .where(eq(schema.servers.id, input.serverId))
        )[0],
      ).status,
    ).toBe('pending')
  })

  test('checks the current default team and prevents both owners leaving concurrently', async () => {
    await main.batch([
      main.insert(schema.user).values(
        ['leave-a', 'leave-b'].map((id) => ({
          id,
          name: id,
          username: id,
          email: `${id}@example.com`,
        })),
      ),
      main
        .insert(schema.teams)
        .values({ id: 'leave-team', name: 'Leave', slug: 'leave-team' }),
      main.insert(schema.teamMembers).values(
        ['leave-a', 'leave-b'].map((id) => ({
          id: `member-${id}`,
          userId: id,
          teamId: 'leave-team',
          role: 'owner' as const,
        })),
      ),
      main
        .update(schema.user)
        .set({ defaultTeamId: 'leave-team' })
        .where(eq(schema.user.id, 'leave-a')),
    ])
    expect(
      await leaveMembership(main, { userId: 'leave-a', teamId: 'leave-team' }),
    ).toBe(false)
    await main
      .update(schema.user)
      .set({ defaultTeamId: null })
      .where(eq(schema.user.id, 'leave-a'))
    const results = await Promise.all(
      ['leave-a', 'leave-b'].map((userId) =>
        leaveMembership(main, { userId, teamId: 'leave-team' }),
      ),
    )
    expect(results.sort()).toEqual([false, true])
    const [owner] = await main
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, 'leave-team'))
    expect(required(owner).role).toBe('owner')
  })

  test('bootstraps only one owned team when login requests race and preserves a valid default', async () => {
    await main.insert(schema.user).values({
      id: 'bootstrap-user',
      name: 'Bootstrap',
      username: 'bootstrap',
      email: 'bootstrap@example.com',
    })
    const inputs = ['bootstrap-a', 'bootstrap-b'].map((teamId) => ({
      userId: 'bootstrap-user',
      teamId,
      name: 'Bootstrap',
      baseSlug: 'bootstrap',
    }))
    expect(
      await Promise.all(inputs.map((input) => bootstrapOwnedTeam(main, input))),
    ).toEqual([true, true])
    const members = await main
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, 'bootstrap-user'))
    expect(members).toHaveLength(1)
    expect(required(members[0]).role).toBe('owner')
    const [user] = await main
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, 'bootstrap-user'))
    expect(required(user).defaultTeamId).toBe(required(members[0]).teamId)
    expect(
      await insertOwnedTeam(main, {
        ...required(inputs[0]),
        teamId: 'another-team',
      }),
    ).toBe(true)
    await bootstrapOwnedTeam(main, {
      ...required(inputs[0]),
      teamId: 'unexpected-team',
    })
    expect(
      required(
        (
          await main
            .select()
            .from(schema.user)
            .where(eq(schema.user.id, 'bootstrap-user'))
        )[0],
      ).defaultTeamId,
    ).toBe(required(user).defaultTeamId)
    expect(
      await main
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, 'unexpected-team')),
    ).toEqual([])
    const another = (
      await main
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, 'another-team'))
    )[0]
    expect(required(another).slug).toBe('bootstrap-another')
    await main
      .update(schema.teams)
      .set({ status: 'deleted' })
      .where(eq(schema.teams.id, required(user).defaultTeamId!))
    await bootstrapOwnedTeam(main, {
      ...required(inputs[0]),
      teamId: 'unused-team',
    })
    expect(
      required(
        (
          await main
            .select()
            .from(schema.user)
            .where(eq(schema.user.id, 'bootstrap-user'))
        )[0],
      ).defaultTeamId,
    ).toBe('another-team')
  })

  test('rolls back a newly created team if its owner membership cannot be stored', async () => {
    await main.run(sql`create trigger reject_owner before insert on team_members
      when new.team_id = 'failed-team' begin select raise(abort, 'simulated owner failure'); end`)
    try {
      await expect(
        insertOwnedTeam(main, {
          userId: 'bootstrap-user',
          teamId: 'failed-team',
          name: 'Fail',
          baseSlug: 'fail',
        }),
      ).rejects.toThrow('simulated owner failure')
      expect(
        await main
          .select()
          .from(schema.teams)
          .where(eq(schema.teams.id, 'failed-team')),
      ).toEqual([])
    } finally {
      await main.run(sql`drop trigger reject_owner`)
    }
    expect(
      await insertOwnedTeam(main, {
        userId: 'missing-user',
        teamId: 'missing-team',
        name: 'Missing',
        baseSlug: 'missing',
      }),
    ).toBe(false)
    expect(
      await main
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, 'missing-team')),
    ).toEqual([])
  })

  test('accepts an invitation once under contention and preserves an existing member role', async () => {
    await main.batch([
      main.insert(schema.user).values({
        id: 'invitee',
        name: 'Invitee',
        username: 'invitee',
        email: ' INVITEE@example.com ',
        emailVerified: true,
      }),
      main
        .insert(schema.teams)
        .values({ id: 'invite-team', slug: 'invite-team', name: 'Invites' }),
      main.insert(schema.teamMembers).values({
        id: 'inviter-membership',
        userId: 'invitee',
        teamId: 'invite-team',
        role: 'owner',
      }),
      main.insert(schema.teamInvites).values({
        id: 'invite',
        teamId: 'invite-team',
        inviterId: 'invitee',
        email: 'invitee@example.com',
        role: 'member',
        tokenHash: 'invite-token',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ])
    const input = {
      userId: 'invitee',
      inviteId: 'invite',
      tokenHash: 'invite-token',
      now: new Date(),
    }
    const results = await Promise.all([
      acceptInvitation(main, input),
      acceptInvitation(main, input),
    ])
    expect(results.sort()).toEqual([false, true])
    const [member] = await main
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, 'inviter-membership'))
    expect(required(member).role).toBe('owner')
    const [invite] = await main
      .select()
      .from(schema.teamInvites)
      .where(eq(schema.teamInvites.id, 'invite'))
    expect(required(invite).status).toBe('accepted')
  })

  test('checks invitation eligibility at mutation time and rolls membership back on acceptance failure', async () => {
    await main.batch([
      main.insert(schema.user).values({
        id: 'new-invitee',
        name: 'New invitee',
        username: 'new-invitee',
        email: 'new-invitee@example.com',
        emailVerified: true,
      }),
      main.insert(schema.teamInvites).values({
        id: 'new-invite',
        teamId: 'invite-team',
        inviterId: 'invitee',
        email: 'new-invitee@example.com',
        role: 'admin',
        tokenHash: 'new-token',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ])
    const input = {
      userId: 'new-invitee',
      inviteId: 'new-invite',
      tokenHash: 'new-token',
      now: new Date(),
    }
    await main
      .update(schema.teamInvites)
      .set({ status: 'revoked' })
      .where(eq(schema.teamInvites.id, input.inviteId))
    expect(await acceptInvitation(main, input)).toBe(false)
    await main
      .update(schema.teamInvites)
      .set({ status: 'pending' })
      .where(eq(schema.teamInvites.id, input.inviteId))
    await main
      .update(schema.user)
      .set({ emailVerified: false })
      .where(eq(schema.user.id, input.userId))
    expect(await acceptInvitation(main, input)).toBe(false)
    await main
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, input.userId))
    expect(
      await acceptInvitation(main, { ...input, tokenHash: 'stale-token' }),
    ).toBe(false)
    expect(
      await acceptInvitation(main, {
        ...input,
        now: new Date(Date.now() + 120_000),
      }),
    ).toBe(false)
    await main
      .update(schema.teams)
      .set({ status: 'deleted' })
      .where(eq(schema.teams.id, 'invite-team'))
    expect(await acceptInvitation(main, input)).toBe(false)
    await main
      .update(schema.teams)
      .set({ status: 'active' })
      .where(eq(schema.teams.id, 'invite-team'))
    await main.run(sql`create trigger reject_invite_acceptance before update of status on team_invites
      when new.id = 'new-invite' and new.status = 'accepted'
      begin select raise(abort, 'simulated acceptance failure'); end`)
    try {
      await expect(acceptInvitation(main, input)).rejects.toThrow(
        'simulated acceptance failure',
      )
      expect(
        await main
          .select()
          .from(schema.teamMembers)
          .where(eq(schema.teamMembers.userId, input.userId)),
      ).toEqual([])
      const [invite] = await main
        .select()
        .from(schema.teamInvites)
        .where(eq(schema.teamInvites.id, input.inviteId))
      expect(required(invite).status).toBe('pending')
    } finally {
      await main.run(sql`drop trigger reject_invite_acceptance`)
    }
    expect(await acceptInvitation(main, input)).toBe(true)
    const [member] = await main
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, input.userId))
    expect(required(member).role).toBe('admin')
  })

  test('preserves the last owner and current permissions when real membership mutations race', async () => {
    await main.batch([
      main.insert(schema.user).values(
        ['owner-a', 'owner-b'].map((id) => ({
          id,
          name: id,
          username: id,
          email: `${id}@example.com`,
        })),
      ),
      main
        .insert(schema.teams)
        .values({ id: 'owner-team', slug: 'owner-team', name: 'Owner team' }),
      main.insert(schema.teamMembers).values(
        ['owner-a', 'owner-b'].map((id) => ({
          id: `membership-${id}`,
          userId: id,
          teamId: 'owner-team',
          role: 'owner' as const,
        })),
      ),
    ])
    const users = ['owner-a', 'owner-b']
    const results = await Promise.all(
      users.map((id) =>
        mutateTeamMembership(main, {
          teamId: 'owner-team',
          actorId: id,
          memberId: id,
          action: 'role',
          role: 'admin',
        }),
      ),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    const members = await main
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, 'owner-team'))
    const owner = members.find((member) => member.role === 'owner')!
    const admin = members.find((member) => member.role === 'admin')!
    expect(
      await mutateTeamMembership(main, {
        teamId: 'owner-team',
        actorId: owner.userId,
        memberId: owner.userId,
        action: 'remove',
      }),
    ).toBe(false)
    expect(
      await mutateTeamMembership(main, {
        teamId: 'owner-team',
        actorId: admin.userId,
        memberId: admin.userId,
        action: 'role',
        role: 'owner',
      }),
    ).toBe(false)
    expect(
      await mutateTeamMembership(main, {
        teamId: 'owner-team',
        actorId: admin.userId,
        memberId: owner.userId,
        action: 'remove',
      }),
    ).toBe(false)
    expect(
      await mutateTeamOwnership(main, {
        teamId: 'owner-team',
        actorId: owner.userId,
        memberId: admin.userId,
      }),
    ).toBe(true)
    const transferred = await main
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, 'owner-team'))
    expect(
      transferred.find((member) => member.userId === owner.userId)?.role,
    ).toBe('admin')
    expect(
      transferred.find((member) => member.userId === admin.userId)?.role,
    ).toBe('owner')
    expect(
      await mutateTeamOwnership(main, {
        teamId: 'owner-team',
        actorId: owner.userId,
        memberId: admin.userId,
      }),
    ).toBe(false)
  })

  test('applies the actual main/log migrations and maps dates, JSON and booleans', async () => {
    const createdAt = new Date('2026-09-30T00:00:00.123Z')
    await main.insert(schema.user).values({
      id: 'user',
      name: 'D1 user',
      username: 'd1-user',
      email: 'd1@example.com',
      emailVerified: true,
      createdAt,
    })
    const [user] = await main
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, 'user'))
    expect(required(user).emailVerified).toBe(true)
    expect(required(user).createdAt).toEqual(createdAt)
    await main.batch([
      main
        .insert(schema.teams)
        .values({ id: 'json-team', slug: 'json-team', name: 'JSON team' }),
      main.insert(schema.servers).values({
        id: 'json-server',
        teamId: 'json-team',
        name: 'JSON server',
        handle: 'json-server',
        agentCapabilities: ['runtime.logs.v1'],
      }),
    ])
    expect(
      required(
        (
          await main
            .select()
            .from(schema.servers)
            .where(eq(schema.servers.id, 'json-server'))
        )[0],
      ).agentCapabilities,
    ).toEqual(['runtime.logs.v1'])
    await logs.insert(logSchema.deploymentLogs).values({
      projectId: 'project',
      environmentId: 'environment',
      deploymentId: 'deployment',
      serverId: 'server',
      branch: 'main',
      stream: 'deploy',
      seq: 1,
      content: 'ready',
      searchContent: 'ready',
      createdAt,
    })
    expect(
      required((await logs.select().from(logSchema.deploymentLogs))[0])
        .createdAt,
    ).toEqual(createdAt)
    expect(
      await main.all(
        sql`select name from sqlite_master where name in ('runtime_logs','deployment_logs')`,
      ),
    ).toEqual([])
  })
  test('rolls back a failed batch instead of leaving its first write committed', async () => {
    await expect(
      main.batch([
        main
          .insert(schema.teams)
          .values({ id: 'rolled-back', slug: 'rolled-back', name: 'Rollback' }),
        main
          .insert(schema.teams)
          .values({ id: 'rolled-back', slug: 'duplicate', name: 'Duplicate' }),
      ]),
    ).rejects.toThrow()
    expect(
      await main
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, 'rolled-back')),
    ).toEqual([])
  })
  test('only one guarded claim wins when requests race', async () => {
    await main
      .insert(schema.teams)
      .values({ id: 'claim', slug: 'claim', name: 'Queued' })
    const claims = await Promise.all(
      ['one', 'two'].map((name) =>
        main
          .update(schema.teams)
          .set({ name })
          .where(
            and(eq(schema.teams.id, 'claim'), eq(schema.teams.name, 'Queued')),
          )
          .returning({ id: schema.teams.id }),
      ),
    )
    expect(claims.flat()).toHaveLength(1)
  })
  test('rejects callback transactions before executing their body', () => {
    let entered = false
    expect(() =>
      main.transaction(async () => {
        entered = true
      }),
    ).toThrow('atomic SQL batches')
    expect(entered).toBe(false)
  })
})

test('Workers select D1 bindings when no remote URLs are configured', async () => {
  const stores = openWorkerDatabases({
    DEVPUSH_DATABASE: await required(runtime).getD1Database('MAIN'),
    DEVPUSH_LOG_DATABASE: await required(runtime).getD1Database('LOGS'),
  })
  expect(await stores.db.all(sql`select 17 as value`)).toEqual([{ value: 17 }])
  expect(await stores.logsDb.all(sql`select 23 as value`)).toEqual([
    { value: 23 },
  ])
})
