import { storedBackupDatabaseSchema } from '#devpush/lib/backup-database'
import { requireProjectRuntimeConfig } from '#devpush/lib/project-runtime-config'
import { PublicError } from '#devpush/lib/public-error'
import { db, logsDb } from '#devpush/server/db'
import {
  deploymentLogs,
  operationLogs,
  runtimeLogs,
} from '#devpush/server/db/log-schema'
import {
  aliases,
  backupArtifacts,
  backupConfigs,
  backupRuns,
  backupStorage,
  deploymentEvents,
  deployments,
  domains,
  environments,
  projects,
  serverMetrics,
  servers,
  teams,
  user,
} from '#devpush/server/db/schema'
import {
  createInstallationAccessToken,
  getGitHubAccount,
  listBranchCommits,
  listInstallationRepositoriesPage,
  listRepositoryBranchesPage,
  listUserInstallationsPage,
} from '#devpush/server/github/service'
import { getEnvironmentForBranch } from '#devpush/server/projects/environment-branches'
import { normalizeProjectRoutes } from '#devpush/server/projects/mappers'
import { readProjectEnvVars } from '#devpush/server/projects/project-env-vars'
import { getEffectiveServerStatus } from '#devpush/server/servers/status'
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, gt, gte, lt, ne, or, sql } from 'drizzle-orm'
import { apiFingerprint, decodeApiCursor, encodeApiCursor } from './cursors'
import { ApiError } from './errors'

import type { OperationContext } from './operation-context'
import {
  backupRow,
  deploymentRow,
  jobRow,
  projectGuard,
  projectRow,
  requireWholeTeam,
  serialize,
  serverSelection,
} from './operation-context'

const projectSelection = {
  id: projects.id,
  teamId: projects.teamId,
  name: projects.name,
  slug: projects.slug,
  repository: projects.githubRepo,
  repositoryId: projects.githubRepoId,
  defaultServerId: projects.defaultServerId,
  settingsVersion: projects.settingsVersion,
  createdAt: projects.createdAt,
}
const deploymentSelection = {
  id: deployments.id,
  projectId: environments.projectId,
  environmentId: deployments.environmentId,
  serverId: deployments.serverId,
  status: deployments.status,
  phase: deployments.phase,
  trigger: deployments.trigger,
  repository: deployments.repoFullName,
  sha: deployments.gitSha,
  branch: deployments.gitBranch,
  createdAt: deployments.createdAt,
  startedAt: deployments.startedAt,
  finishedAt: deployments.finishedAt,
}
const backupSelection = {
  id: backupRuns.id,
  projectId: backupRuns.projectId,
  environmentId: backupRuns.environmentId,
  deploymentId: backupRuns.deploymentId,
  serverId: backupRuns.serverId,
  status: backupRuns.status,
  createdAt: backupRuns.createdAt,
  startedAt: backupRuns.startedAt,
  finishedAt: backupRuns.finishedAt,
}
function publicEndpoint(value: string | null) {
  if (!value) return null
  try {
    const endpoint = new URL(value)
    endpoint.username = ''
    endpoint.password = ''
    endpoint.search = ''
    endpoint.hash = ''
    return endpoint.toString()
  } catch {
    return null
  }
}
function cursorContext(context: OperationContext) {
  const { cursor: _cursor, limit: _limit, ...filters } = context.input
  return apiFingerprint({
    operation: context.operation.id,
    membershipId: context.principal.membershipId,
    projects: context.principal.projectIds,
    filters,
  })
}
function pageState(context: OperationContext, date: SQL | any, id: SQL | any) {
  const scope = cursorContext(context)
  const cursor = decodeApiCursor(context.input.cursor, scope)
  return {
    scope,
    condition: cursor
      ? or(
          lt(date, new Date(cursor.position)),
          and(eq(date, new Date(cursor.position)), lt(id, cursor.id)),
        )
      : undefined,
  }
}
function page<T extends { id: string; createdAt: Date }>(
  context: OperationContext,
  rows: T[],
) {
  const hasMore = rows.length > context.input.limit
  const items = rows.slice(0, context.input.limit)
  const last = items.at(-1)
  return {
    items: serialize(items),
    nextCursor:
      hasMore && last
        ? encodeApiCursor(
            cursorContext(context),
            last.createdAt.getTime(),
            last.id,
          )
        : null,
  }
}

export async function readOperation(
  context: OperationContext,
): Promise<unknown> {
  const { principal, input: i, operation } = context
  const limit = Number(i.limit ?? 25)
  if (
    operation.id === 'list_github_installations' ||
    operation.id === 'list_github_repositories'
  ) {
    const account = await getGitHubAccount(principal.userId)
    if (!account) throw new PublicError('PROJECT_GITHUB_ACCOUNT_REQUIRED')
    const scope = `${cursorContext(context)}:provider:${limit}`
    const providerPage = decodeApiCursor(i.cursor, scope)?.position ?? 1
    if (providerPage < 1) throw new ApiError('INVALID_CURSOR', 400)
    if (operation.id === 'list_github_installations') {
      const response = await listUserInstallationsPage({
        accessToken: account.accessToken,
        page: providerPage,
        perPage: limit,
      })
      return {
        items: response.items,
        nextCursor: response.hasMore
          ? encodeApiCursor(scope, providerPage + 1)
          : null,
      }
    }
    const response = await listInstallationRepositoriesPage({
      accessToken: account.accessToken,
      installationId: i.installationId,
      page: providerPage,
      perPage: limit,
    })
    return {
      items: response.items
        .filter((repository) => repository.permissions.push)
        .map((repository) => ({
          id: repository.id,
          installationId: i.installationId,
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          private: repository.private,
        })),
      nextCursor: response.hasMore
        ? encodeApiCursor(scope, providerPage + 1)
        : null,
    }
  }
  if (operation.id === 'get_backup_policy') {
    const { project } = await projectRow(context, i.projectId)
    const [policy] = await db
      .select()
      .from(backupConfigs)
      .where(
        and(
          eq(backupConfigs.id, i.policyId),
          eq(backupConfigs.projectId, project.id),
        ),
      )
      .limit(1)
    if (!policy) throw new PublicError('BACKUP_POLICY_NOT_FOUND')
    const dumps = Array.isArray(policy.databaseDumps)
      ? policy.databaseDumps.map((dump) => {
          const { legacyCommand: _command, ...safe } =
            storedBackupDatabaseSchema.parse(dump)
          return safe
        })
      : []
    return {
      id: policy.id,
      projectId: project.id,
      settingsVersion: policy.settingsVersion,
      name: policy.name,
      environmentId: policy.environmentId,
      enabled: policy.enabled,
      schedule: policy.schedule,
      destination: policy.destination,
      retention: policy.retention,
      volumes: policy.volumes,
      databaseDumps: dumps,
    }
  }
  if (operation.id === 'get_identity') {
    const [row] = await db
      .select({
        user: { id: user.id, name: user.name, username: user.username },
        team: { id: teams.id, name: teams.name, slug: teams.slug },
      })
      .from(user)
      .innerJoin(teams, eq(teams.id, principal.teamId))
      .where(eq(user.id, principal.userId))
      .limit(1)
    if (!row) throw new ApiError('NOT_FOUND', 404)
    return {
      ...row,
      scopes: principal.scopes,
      projectIds: principal.projectIds,
    }
  }
  if (operation.id === 'list_projects') {
    const pagination = pageState(context, projects.createdAt, projects.id)
    return page(
      context,
      await db
        .select(projectSelection)
        .from(projects)
        .where(
          and(projectGuard(principal, operation.scope), pagination.condition),
        )
        .orderBy(desc(projects.createdAt), desc(projects.id))
        .limit(limit + 1),
    )
  }
  if (operation.id === 'get_project') {
    await projectRow(context, i.projectId)
    const [row] = await db
      .select(projectSelection)
      .from(projects)
      .where(eq(projects.id, i.projectId))
      .limit(1)
    return serialize(row)
  }
  if (
    (operation.id.startsWith('list_') && i.projectId) ||
    [
      'get_project_configuration',
      'read_runtime_logs',
      'get_deployment_options',
    ].includes(operation.id)
  ) {
    const { project } = await projectRow(context, i.projectId)
    if (operation.id === 'list_environments') {
      const pagination = pageState(
        context,
        environments.createdAt,
        environments.id,
      )
      return page(
        context,
        await db
          .select({
            id: environments.id,
            projectId: environments.projectId,
            name: environments.name,
            slug: environments.slug,
            branch: environments.branch,
            isProduction: environments.isProduction,
            position: environments.position,
            color: environments.color,
            serverId: sql<
              string | null
            >`coalesce(${environments.serverId}, ${project.defaultServerId})`,
            createdAt: environments.createdAt,
          })
          .from(environments)
          .where(
            and(
              eq(environments.projectId, project.id),
              eq(environments.status, 'active'),
              pagination.condition,
            ),
          )
          .orderBy(desc(environments.createdAt), desc(environments.id))
          .limit(limit + 1),
      )
    }
    if (operation.id === 'get_project_configuration')
      return {
        settingsVersion: project.settingsVersion,
        runtimeConfig: requireProjectRuntimeConfig(project.runtimeConfig),
        routes: normalizeProjectRoutes(project.routes),
      }
    if (operation.id === 'get_deployment_options') {
      if (!project.githubInstallationId || !project.githubRepoId)
        throw new PublicError('DEPLOYMENT_GITHUB_INSTALLATION_REQUIRED')
      const projectEnvironments = await db
        .select({
          id: environments.id,
          branch: environments.branch,
          slug: environments.slug,
          isProduction: environments.isProduction,
        })
        .from(environments)
        .where(
          and(
            eq(environments.projectId, project.id),
            eq(environments.status, 'active'),
          ),
        )
        .orderBy(asc(environments.position), asc(environments.id))
        .limit(1001)
      if (projectEnvironments.length > 1000)
        throw new ApiError('OPERATION_CONFLICT', 409)
      if (
        !projectEnvironments.some(
          (environment) => environment.id === i.environmentId,
        )
      )
        throw new PublicError('DEPLOYMENT_ENVIRONMENT_NOT_FOUND')
      const token = await createInstallationAccessToken({
        installationId: project.githubInstallationId,
        repositoryId: project.githubRepoId,
        repositoryFullName: project.githubRepo,
      })
      if (
        i.branch &&
        getEnvironmentForBranch(i.branch, projectEnvironments)?.id !==
          i.environmentId
      )
        throw new PublicError('DEPLOYMENT_BRANCH_MISMATCH')
      const scope = `${cursorContext(context)}:provider:${i.limit}:${project.settingsVersion}`
      const providerPage = decodeApiCursor(i.cursor, scope)?.position ?? 1
      if (providerPage < 1) throw new ApiError('INVALID_CURSOR', 400)
      const response = await listRepositoryBranchesPage({
        accessToken: token.token,
        repo: project.githubRepo,
        page: providerPage,
        perPage: i.limit,
      })
      const branches = response.items.filter(
        (branch) =>
          getEnvironmentForBranch(branch, projectEnvironments)?.id ===
          i.environmentId,
      )
      const selectedBranch = i.branch ?? branches[0] ?? null
      const commits = selectedBranch
        ? await listBranchCommits({
            accessToken: token.token,
            branch: selectedBranch,
            repo: project.githubRepo,
            perPage: 5,
          })
        : []
      return {
        branches,
        nextCursor: response.hasMore
          ? encodeApiCursor(scope, providerPage + 1)
          : null,
        selectedBranch,
        commits: commits.map((commit) => ({
          sha: commit.sha,
          message: commit.message,
          url: commit.url,
          authorName: commit.authorName,
          authoredAt: commit.authoredAt,
        })),
      }
    }
    if (operation.id === 'list_variables') {
      const values = readProjectEnvVars(project)
        .map(({ key, environment }) => ({
          key,
          environmentId: environment || null,
        }))
        .sort((a, b) =>
          `${a.environmentId ?? ''}\0${a.key}`.localeCompare(
            `${b.environmentId ?? ''}\0${b.key}`,
          ),
        )
      const scope = cursorContext(context)
      const cursor = decodeApiCursor(
        i.cursor,
        `${scope}:${project.settingsVersion}`,
      )
      const offset = cursor?.position ?? 0
      return {
        items: values.slice(offset, offset + limit),
        nextCursor:
          offset + limit < values.length
            ? encodeApiCursor(
                `${scope}:${project.settingsVersion}`,
                offset + limit,
              )
            : null,
        settingsVersion: project.settingsVersion,
      }
    }
    if (operation.id === 'list_domains' || operation.id === 'list_aliases') {
      const table = operation.id === 'list_domains' ? domains : aliases
      const pagination = pageState(context, table.createdAt, table.id)
      if (operation.id === 'list_domains')
        return page(
          context,
          await db
            .select({
              id: domains.id,
              environmentId: domains.environmentId,
              hostname: domains.hostname,
              basePath: domains.basePath,
              https: domains.https,
              status: domains.status,
              createdAt: domains.createdAt,
            })
            .from(domains)
            .where(and(eq(domains.projectId, project.id), pagination.condition))
            .orderBy(desc(domains.createdAt), desc(domains.id))
            .limit(limit + 1),
        )
      return page(
        context,
        await db
          .select({
            id: aliases.id,
            environmentId: aliases.environmentId,
            deploymentId: aliases.deploymentId,
            hostname: aliases.hostname,
            type: aliases.type,
            branch: aliases.branch,
            https: aliases.https,
            createdAt: aliases.createdAt,
          })
          .from(aliases)
          .where(and(eq(aliases.projectId, project.id), pagination.condition))
          .orderBy(desc(aliases.createdAt), desc(aliases.id))
          .limit(limit + 1),
      )
    }
    if (operation.id === 'list_deployments') {
      const pagination = pageState(
        context,
        deployments.createdAt,
        deployments.id,
      )
      return page(
        context,
        await db
          .select(deploymentSelection)
          .from(deployments)
          .innerJoin(
            environments,
            eq(environments.id, deployments.environmentId),
          )
          .where(
            and(
              eq(environments.projectId, project.id),
              i.environmentId
                ? eq(environments.id, i.environmentId)
                : undefined,
              pagination.condition,
            ),
          )
          .orderBy(desc(deployments.createdAt), desc(deployments.id))
          .limit(limit + 1),
      )
    }
    if (operation.id === 'list_backups') {
      const pagination = pageState(context, backupRuns.createdAt, backupRuns.id)
      return page(
        context,
        await db
          .select(backupSelection)
          .from(backupRuns)
          .where(
            and(
              eq(backupRuns.projectId, project.id),
              i.environmentId
                ? eq(backupRuns.environmentId, i.environmentId)
                : undefined,
              pagination.condition,
            ),
          )
          .orderBy(desc(backupRuns.createdAt), desc(backupRuns.id))
          .limit(limit + 1),
      )
    }
    if (operation.id === 'list_backup_policies') {
      const pagination = pageState(
        context,
        backupConfigs.createdAt,
        backupConfigs.id,
      )
      return page(
        context,
        await db
          .select({
            id: backupConfigs.id,
            name: backupConfigs.name,
            environmentId: backupConfigs.environmentId,
            enabled: backupConfigs.enabled,
            createdAt: backupConfigs.createdAt,
          })
          .from(backupConfigs)
          .where(
            and(eq(backupConfigs.projectId, project.id), pagination.condition),
          )
          .orderBy(desc(backupConfigs.createdAt), desc(backupConfigs.id))
          .limit(limit + 1),
      )
    }
    if (operation.id === 'read_runtime_logs')
      return readRuntimeLogs(context, project)
  }
  if (operation.id === 'get_deployment') {
    await deploymentRow(context, i.deploymentId)
    const [row] = await db
      .select(deploymentSelection)
      .from(deployments)
      .innerJoin(environments, eq(environments.id, deployments.environmentId))
      .where(eq(deployments.id, i.deploymentId))
      .limit(1)
    return serialize(row)
  }
  if (operation.id === 'read_deployment_logs') {
    await deploymentRow(context, i.deploymentId)
    const table = i.stream === 'control' ? deploymentEvents : deploymentLogs
    const cursor = decodeApiCursor(i.cursor, cursorContext(context))
    const store = i.stream === 'control' ? db : logsDb
    const rows = await store
      .select({
        position: table.seq,
        content: table.content,
        createdAt: table.createdAt,
      })
      .from(table)
      .where(
        and(
          eq(table.deploymentId, i.deploymentId),
          eq(table.stream, i.stream === 'control' ? 'control' : 'deploy'),
          gt(table.seq, cursor?.position ?? 0),
        ),
      )
      .orderBy(asc(table.seq))
      .limit(limit + 1)
    return logPage(context, rows)
  }
  if (
    operation.id === 'list_servers' ||
    operation.id === 'get_server' ||
    operation.id === 'read_server_metrics' ||
    operation.id === 'get_server_delete_diagnostic'
  ) {
    requireWholeTeam(principal)
    const conditions = [
      eq(servers.teamId, principal.teamId),
      ne(servers.status, 'deleted'),
    ]
    if (i.serverId) conditions.push(eq(servers.id, i.serverId))
    if (operation.id === 'list_servers') {
      const pagination = pageState(context, servers.createdAt, servers.id)
      const rows = await db
        .select(serverSelection)
        .from(servers)
        .where(and(...conditions, pagination.condition))
        .orderBy(desc(servers.createdAt), desc(servers.id))
        .limit(limit + 1)
      return page(
        context,
        rows.map((row) => ({ ...row, status: getEffectiveServerStatus(row) })),
      )
    }
    const [row] = await db
      .select(serverSelection)
      .from(servers)
      .where(and(...conditions))
      .limit(1)
    if (!row) throw new ApiError('NOT_FOUND', 404)
    if (operation.id === 'get_server_delete_diagnostic') {
      const [counts] = await db
        .select({
          projectCount: sql<number>`count(distinct ${projects.id})`,
          environmentCount: sql<number>`count(*)`,
        })
        .from(environments)
        .innerJoin(projects, eq(projects.id, environments.projectId))
        .where(
          and(
            eq(projects.teamId, principal.teamId),
            eq(projects.status, 'active'),
            eq(environments.status, 'active'),
            sql`coalesce(${environments.serverId},${projects.defaultServerId}) = ${row.id}`,
          ),
        )
      return {
        serverId: row.id,
        projectCount: Number(counts?.projectCount ?? 0),
        environmentCount: Number(counts?.environmentCount ?? 0),
      }
    }
    if (operation.id === 'get_server')
      return serialize({ ...row, status: getEffectiveServerStatus(row) })
    const scope = cursorContext(context)
    const cursor = decodeApiCursor(i.cursor, scope)
    const metricRows = await db
      .select({
        id: serverMetrics.id,
        observedAt: serverMetrics.observedAt,
        cpuPercent: serverMetrics.cpuPercent,
        memoryUsedBytes: serverMetrics.memoryUsedBytes,
        memoryTotalBytes: serverMetrics.memoryTotalBytes,
        diskUsedBytes: serverMetrics.diskUsedBytes,
        diskTotalBytes: serverMetrics.diskTotalBytes,
        networkReceiveBytesPerSecond:
          serverMetrics.networkReceiveBytesPerSecond,
        networkTransmitBytesPerSecond:
          serverMetrics.networkTransmitBytesPerSecond,
      })
      .from(serverMetrics)
      .where(
        and(
          eq(serverMetrics.serverId, row.id),
          i.since
            ? gte(serverMetrics.observedAt, new Date(i.since))
            : undefined,
          cursor
            ? or(
                lt(serverMetrics.observedAt, new Date(cursor.position)),
                and(
                  eq(serverMetrics.observedAt, new Date(cursor.position)),
                  lt(serverMetrics.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(serverMetrics.observedAt), desc(serverMetrics.id))
      .limit(limit + 1)
    const items = metricRows.slice(0, limit)
    const last = items.at(-1)
    return {
      items: serialize(items),
      nextCursor:
        metricRows.length > limit && last
          ? encodeApiCursor(scope, last.observedAt.getTime(), last.id)
          : null,
    }
  }
  if (
    operation.id === 'get_backup' ||
    operation.id === 'list_backup_artifacts'
  ) {
    await backupRow(context, i.backupRunId)
    if (operation.id === 'get_backup') {
      const [row] = await db
        .select(backupSelection)
        .from(backupRuns)
        .where(eq(backupRuns.id, i.backupRunId))
        .limit(1)
      return serialize(row)
    }
    const pagination = pageState(
      context,
      backupArtifacts.createdAt,
      backupArtifacts.id,
    )
    return page(
      context,
      await db
        .select({
          id: backupArtifacts.id,
          type: backupArtifacts.type,
          storage: backupArtifacts.storage,
          sizeBytes: backupArtifacts.sizeBytes,
          checksumSha256: backupArtifacts.checksumSha256,
          createdAt: backupArtifacts.createdAt,
        })
        .from(backupArtifacts)
        .where(
          and(
            eq(backupArtifacts.backupRunId, i.backupRunId),
            pagination.condition,
          ),
        )
        .orderBy(desc(backupArtifacts.createdAt), desc(backupArtifacts.id))
        .limit(limit + 1),
    )
  }
  if (operation.id === 'list_backup_storage') {
    requireWholeTeam(principal)
    const pagination = pageState(
      context,
      backupStorage.createdAt,
      backupStorage.id,
    )
    const rows = await db
      .select({
        settingsVersion: backupStorage.settingsVersion,
        id: backupStorage.id,
        name: backupStorage.name,
        bucket: backupStorage.bucket,
        region: backupStorage.region,
        endpoint: backupStorage.endpoint,
        createdAt: backupStorage.createdAt,
      })
      .from(backupStorage)
      .where(
        and(eq(backupStorage.teamId, principal.teamId), pagination.condition),
      )
      .orderBy(desc(backupStorage.createdAt), desc(backupStorage.id))
      .limit(limit + 1)
    return page(
      context,
      rows.map((row) => ({ ...row, endpoint: publicEndpoint(row.endpoint) })),
    )
  }
  if (operation.id === 'get_job' || operation.id === 'read_job_logs') {
    const { job, projectId } = await jobRow(context, i.jobId)
    if (operation.id === 'get_job')
      return serialize({
        id: job.id,
        projectId,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
      })
    const cursor = decodeApiCursor(i.cursor, cursorContext(context))
    const rows = await logsDb
      .select({
        position: operationLogs.offset,
        content: operationLogs.content,
        createdAt: operationLogs.createdAt,
      })
      .from(operationLogs)
      .where(
        and(
          eq(operationLogs.jobId, job.id),
          gt(operationLogs.offset, cursor?.position ?? -1),
        ),
      )
      .orderBy(asc(operationLogs.offset))
      .limit(limit + 1)
    return logPage(context, rows)
  }
  throw new ApiError('NOT_FOUND', 404)
}

function boundedLogContent(content: string) {
  const bytes = new TextEncoder().encode(content)
  if (bytes.length <= 64 * 1024) return { content, truncated: false }
  // Streaming decoding omits an incomplete trailing UTF-8 sequence instead of
  // adding a replacement character that could exceed the advertised byte cap.
  return {
    content: new TextDecoder().decode(bytes.subarray(0, 64 * 1024), {
      stream: true,
    }),
    truncated: true,
  }
}
function logPage(
  context: OperationContext,
  rows: Array<{ position: number; content: string; createdAt: Date }>,
) {
  let bytes = 0
  const items = []
  for (const row of rows.slice(0, context.input.limit)) {
    const bounded = boundedLogContent(row.content)
    const length = new TextEncoder().encode(bounded.content).length
    if (items.length && bytes + length > 256 * 1024) break
    bytes += length
    items.push({
      position: row.position,
      ...bounded,
      createdAt: row.createdAt.toISOString(),
    })
  }
  return {
    items,
    nextCursor:
      rows.length > items.length && items.length
        ? encodeApiCursor(cursorContext(context), items.at(-1)!.position)
        : null,
    retentionMayHaveRemovedEarlierEntries: true,
  }
}
async function readRuntimeLogs(
  context: OperationContext,
  project: typeof projects.$inferSelect,
) {
  const i = context.input
  const scopes = await db
    .select({
      id: environments.id,
      runtimeId: environments.runtimeId,
      serverId: sql<
        string | null
      >`coalesce(${environments.serverId}, ${project.defaultServerId})`,
    })
    .from(environments)
    .where(
      and(
        eq(environments.projectId, project.id),
        eq(environments.status, 'active'),
        i.environmentId ? eq(environments.id, i.environmentId) : undefined,
      ),
    )
    .limit(1001)
  // A bounded public query never silently scans an unbounded environment set.
  if (scopes.length > 1000) throw new ApiError('OPERATION_CONFLICT', 409)
  const cursor = decodeApiCursor(i.cursor, cursorContext(context))
  const authorizedScopes = scopes.filter((row) => row.serverId)
  if (!authorizedScopes.length)
    return {
      items: [],
      nextCursor: null,
      retentionMayHaveRemovedEarlierEntries: true,
    }
  const rows = await logsDb
    .select({
      id: runtimeLogs.id,
      environmentId: runtimeLogs.environmentId,
      service: runtimeLogs.service,
      content: runtimeLogs.content,
      observedAt: runtimeLogs.observedAt,
    })
    .from(runtimeLogs)
    .where(
      and(
        eq(runtimeLogs.projectId, project.id),
        sql`exists(select 1 from json_each(${JSON.stringify(authorizedScopes)}) as scope where json_extract(scope.value,'$.id') = ${runtimeLogs.environmentId} and json_extract(scope.value,'$.serverId') = ${runtimeLogs.serverId} and json_extract(scope.value,'$.runtimeId') = ${runtimeLogs.runtimeId})`,
        i.service ? eq(runtimeLogs.service, i.service) : undefined,
        i.keyword
          ? sql`instr(${runtimeLogs.searchContent},${i.keyword.toLowerCase()}) > 0`
          : undefined,
        i.since ? gte(runtimeLogs.observedAt, new Date(i.since)) : undefined,
        cursor
          ? or(
              lt(runtimeLogs.observedAt, new Date(cursor.position)),
              and(
                eq(runtimeLogs.observedAt, new Date(cursor.position)),
                lt(runtimeLogs.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(runtimeLogs.observedAt), desc(runtimeLogs.id))
    .limit(i.limit + 1)
  let bytes = 0
  const items = []
  for (const row of rows.slice(0, i.limit)) {
    const bounded = boundedLogContent(row.content)
    const length = new TextEncoder().encode(bounded.content).length
    if (items.length && bytes + length > 256 * 1024) break
    bytes += length
    items.push({ ...row, ...bounded })
  }
  const last = items.at(-1)
  return {
    items: serialize(items),
    nextCursor:
      rows.length > items.length && last
        ? encodeApiCursor(
            cursorContext(context),
            last.observedAt.getTime(),
            last.id,
          )
        : null,
    retentionMayHaveRemovedEarlierEntries: true,
  }
}
