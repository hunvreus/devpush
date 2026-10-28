import { PublicError } from '#devpush/lib/public-error'
import { listBackupStorage } from '#devpush/server/backups/storage'
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  ne,
  sql,
} from 'drizzle-orm'

import { db } from '#devpush/server/db'
import {
  agentRuntimeObservations,
  agentJobs,
  aliases,
  backupArtifacts,
  backupConfigs,
  backupRuns,
  deployments,
  domains,
  environments,
  projects,
  servers,
  teamMembers,
  teams,
} from '#devpush/server/db/schema'
import { readProjectRuntimeLogs, projectHasRuntimeLogs } from './runtime-logs'
import {
  readProjectDeploymentLogs,
  projectHasDeploymentLogs,
} from './deployment-logs'
import { getResourceColor } from '#devpush/server/resources/color'
import { getUserContext } from '#devpush/server/teams/service'
import {
  listTeamProjects,
  listTeamServers,
} from '#devpush/server/teams/queries'
import { requireProjectRuntimeConfig } from '#devpush/lib/project-runtime-config'
import type { ProjectComposeMetadata } from './compose-metadata'
import {
  expandPublicRoutesFromHostnames,
  getEffectiveProjectRoutes,
  getEnvVarsForEnvironment,
  getProductionEnvironment,
  mapBackupConfig,
  mapBackupRun,
  mapDeployment,
  mapEnvironment,
  mapEnvironmentConfig,
  mapProjectDomains,
  mapRuntimeObservation,
  normalizeProjectRoutes,
  toRouteHostnames,
} from './mappers'
import { readProjectEnvVars } from './project-env-vars'
import type {
  DeploymentSectionContext,
  DeploymentSummary,
  ProjectContext,
  ProjectContextScope,
  ProjectLogEntry,
  ProjectLogsSectionContext,
  ProjectSectionContext,
} from './types'

async function requireProjectIdentity({
  userId,
  teamSlug,
  projectName,
  includeEnvVars = false,
  includeComposeMetadata = false,
}: {
  userId: string
  teamSlug: string
  projectName: string
  includeEnvVars?: boolean
  includeComposeMetadata?: boolean
}) {
  const { envVarsEncrypted, composeMetadata, ...projectColumns } =
    getTableColumns(projects)
  const rows = await db
    .select({
      team: {
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        settingsVersion: teams.settingsVersion,
        image: teams.avatarPath,
        role: teamMembers.role,
      },
      project: {
        ...projectColumns,
        envVarsEncrypted: includeEnvVars
          ? envVarsEncrypted
          : sql<string | null>`null`,
        composeMetadata: includeComposeMetadata
          ? composeMetadata
          : sql<typeof projects.$inferSelect.composeMetadata>`null`,
      },
      environment: environments,
      server: {
        id: servers.id,
        name: servers.name,
        status: servers.status,
        lastSeenAt: servers.lastSeenAt,
      },
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(
      projects,
      and(
        eq(projects.teamId, teams.id),
        eq(projects.slug, projectName),
        eq(projects.status, 'active'),
      ),
    )
    .innerJoin(
      environments,
      and(
        eq(environments.projectId, projects.id),
        eq(environments.isProduction, true),
      ),
    )
    .leftJoin(
      servers,
      eq(
        servers.id,
        sql`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
      ),
    )
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teams.slug, teamSlug),
        eq(teams.status, 'active'),
      ),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new PublicError('PROJECT_NOT_FOUND')
  }

  return row
}

export async function getProjectContext({
  userId,
  teamSlug,
  projectName,
  scope = 'full',
}: {
  userId: string
  teamSlug: string
  projectName: string
  scope?: ProjectContextScope
}): Promise<ProjectContext> {
  const [row, userContext] = await Promise.all([
    requireProjectIdentity({
      userId,
      teamSlug,
      projectName,
      includeEnvVars: scope === 'settings' || scope === 'full',
      includeComposeMetadata: ['settings', 'backups', 'full'].includes(scope),
    }),
    getUserContext(userId),
  ])
  const team = {
    ...row.team,
    color: getResourceColor(row.team.id),
  }

  const deploymentsRequested = ['deployments', 'full', 'overview'].includes(
    scope,
  )
  const settingsRequested = ['full', 'settings'].includes(scope)
  const backupsRequested = ['backups', 'full'].includes(scope)
  const runtimeRequested = ['full', 'overview'].includes(scope)
  const projectEnvVars = settingsRequested
    ? readProjectEnvVars(row.project)
    : []
  const [
    projectDeployments,
    teamProjects,
    teamServers,
    environmentRows,
    aliasRows,
    domainRows,
    backupRows,
    runtimeObservationRows,
  ] = await Promise.all([
    deploymentsRequested
      ? listProjectDeployments(row.project.id)
      : Promise.resolve([]),
    listTeamProjects(team.id),
    listTeamServers(team.id, { includeMonitoring: false }),
    db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.projectId, row.project.id),
          eq(environments.status, 'active'),
        ),
      )
      .orderBy(asc(environments.position), asc(environments.createdAt)),
    db
      .select()
      .from(aliases)
      .where(
        and(
          eq(aliases.projectId, row.project.id),
          ne(aliases.type, 'deployment'),
        ),
      ),
    settingsRequested
      ? db.select().from(domains).where(eq(domains.projectId, row.project.id))
      : Promise.resolve([]),
    backupsRequested
      ? listProjectBackupRows(row.project.id)
      : Promise.resolve(null),
    runtimeRequested && row.server
      ? db
          .select({
            lastSeenAt: agentRuntimeObservations.lastSeenAt,
            services: agentRuntimeObservations.services,
          })
          .from(agentRuntimeObservations)
          .where(
            and(
              eq(agentRuntimeObservations.serverId, row.server.id),
              eq(agentRuntimeObservations.runtimeId, row.environment.runtimeId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ])
  const projectEnvironments = environmentRows.map((environment) => ({
    ...mapEnvironmentConfig(environment, row.project.defaultServerId),
    defaultHost:
      aliasRows.find(
        (alias) =>
          alias.environmentId === environment.id &&
          alias.type === 'environment',
      )?.hostname ?? null,
    defaultRouteHttps:
      aliasRows.find(
        (alias) =>
          alias.environmentId === environment.id &&
          alias.type === 'environment',
      )?.https ?? true,
  }))
  const backupData = backupRows
    ? mapProjectBackupRows(backupRows, projectEnvironments)
    : { backupConfigs: [], backupRuns: [], backupRestores: [] }
  const productionEnvironment = getProductionEnvironment(projectEnvironments)
  if (!productionEnvironment) throw new Error('Project has no environments.')
  const productionEnvironmentRow =
    environmentRows.find(
      (environment) => environment.id === productionEnvironment.id,
    ) ?? row.environment
  const productionServerId =
    productionEnvironmentRow.serverId ?? row.project.defaultServerId
  const productionServer =
    teamServers.find((server) => server.id === productionServerId) ?? null
  const projectRoutes = normalizeProjectRoutes(row.project.routes)
  const productionRoutes = getEffectiveProjectRoutes(
    projectRoutes,
    productionEnvironment.id,
  )
  const productionAliases = aliasRows.filter(
    (alias) =>
      alias.environmentId === productionEnvironment.id &&
      alias.type !== 'deployment',
  )
  const productionDomains = domainRows.filter(
    (domain) =>
      domain.environmentId === productionEnvironment.id &&
      domain.status === 'active',
  )
  const productionPublicRoutes = expandPublicRoutesFromHostnames(
    productionRoutes,
    toRouteHostnames(productionAliases, productionDomains),
  )
  const composeMetadata =
    settingsRequested || backupsRequested
      ? parseStoredComposeMetadata(row.project.composeMetadata)
      : null
  const productionDefaultHost =
    productionAliases.find((alias) => alias.type === 'environment')?.hostname ??
    null

  return {
    userContext,
    team,
    project: mapProject(row.project),
    teamProjects,
    routes: projectRoutes,
    composeMetadata,
    domains: mapProjectDomains(domainRows),
    envVars: projectEnvVars,
    backupStorage: backupsRequested ? await listBackupStorage(team.id) : [],
    ...backupData,
    environment: {
      ...mapEnvironment(row.environment, row.server),
      defaultHost: productionDefaultHost,
      color: productionEnvironment.color,
      serverId: productionServer?.id ?? null,
      serverName: productionServer?.name ?? null,
      serverStatus: productionServer?.status ?? null,
      serverAgentUpdate: productionServer?.agentUpdate ?? null,
      envVars: getEnvVarsForEnvironment(
        projectEnvVars,
        productionEnvironment.id,
      ),
      publicRoutes: productionPublicRoutes,
      runtime: mapRuntimeObservation(runtimeObservationRows.at(0) ?? null),
    },
    environments: projectEnvironments,
    deployments: projectDeployments,
    servers: teamServers,
  }
}

export async function getProjectSectionContext({
  userId,
  teamSlug,
  projectName,
  scope,
}: {
  userId: string
  teamSlug: string
  projectName: string
  scope: ProjectSectionContext['scope']
}): Promise<ProjectSectionContext> {
  if (scope === 'settings') {
    const context = await getProjectContext({
      userId,
      teamSlug,
      projectName,
      scope: 'settings',
    })
    return {
      scope,
      projectId: context.project.id,
      context,
      composeMetadata: context.composeMetadata,
      domains: context.domains,
      envVars: context.envVars,
    }
  }

  const row = await requireProjectIdentity({
    userId,
    teamSlug,
    projectName,
    includeComposeMetadata: scope === 'backups',
  })

  if (scope === 'overview') {
    const [projectDeployments, runtimeRows] = await Promise.all([
      listProjectDeployments(row.project.id),
      row.server
        ? db
            .select({
              lastSeenAt: agentRuntimeObservations.lastSeenAt,
              services: agentRuntimeObservations.services,
            })
            .from(agentRuntimeObservations)
            .where(
              and(
                eq(agentRuntimeObservations.serverId, row.server.id),
                eq(
                  agentRuntimeObservations.runtimeId,
                  row.environment.runtimeId,
                ),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
    ])

    return {
      scope,
      projectId: row.project.id,
      deployments: projectDeployments,
      runtime: mapRuntimeObservation(runtimeRows.at(0) ?? null),
    }
  }

  if (scope === 'deployments') {
    return {
      scope,
      projectId: row.project.id,
      deployments: await listProjectDeployments(row.project.id),
    }
  }

  const [backupRows, environmentRows] = await Promise.all([
    listProjectBackupRows(row.project.id),
    db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.projectId, row.project.id),
          eq(environments.status, 'active'),
        ),
      )
      .orderBy(asc(environments.position), asc(environments.createdAt)),
  ])
  const projectEnvironments = environmentRows.map((environment) =>
    mapEnvironmentConfig(environment, row.project.defaultServerId),
  )

  return {
    scope,
    projectId: row.project.id,
    backupStorage: await listBackupStorage(row.project.teamId),
    ...mapProjectBackupRows(backupRows, projectEnvironments),
    composeMetadata: parseStoredComposeMetadata(row.project.composeMetadata),
  }
}

async function listProjectBackupRows(projectId: string) {
  const [configs, runs, restores] = await Promise.all([
    db
      .select()
      .from(backupConfigs)
      .where(eq(backupConfigs.projectId, projectId)),
    db
      .select({
        backupRun: backupRuns,
        environment: environments,
        server: servers,
      })
      .from(backupRuns)
      .innerJoin(environments, eq(environments.id, backupRuns.environmentId))
      .leftJoin(servers, eq(servers.id, backupRuns.serverId))
      .where(eq(backupRuns.projectId, projectId))
      .orderBy(desc(backupRuns.createdAt))
      .limit(50),
    db
      .select({
        id: agentJobs.id,
        serverId: agentJobs.serverId,
        serverName: servers.name,
        artifacts: sql<unknown>`json_extract(${agentJobs.payload}, '$.artifacts')`,
        backupRunId: sql<string>`json_extract(${agentJobs.payload}, '$.backupRunId')`,
        environmentId: sql<string>`json_extract(${agentJobs.payload}, '$.environmentId')`,
        status: agentJobs.status,
        errorMessage: agentJobs.errorMessage,
        createdAt: agentJobs.createdAt,
        startedAt: agentJobs.claimedAt,
        finishedAt: agentJobs.finishedAt,
      })
      .from(agentJobs)
      .leftJoin(servers, eq(servers.id, agentJobs.serverId))
      .where(
        and(eq(agentJobs.projectId, projectId), eq(agentJobs.type, 'restore')),
      )
      .orderBy(desc(agentJobs.createdAt))
      .limit(50),
  ])
  const runIds = runs.map(({ backupRun }) => backupRun.id)
  const artifacts = runIds.length
    ? await db
        .select()
        .from(backupArtifacts)
        .where(inArray(backupArtifacts.backupRunId, runIds))
    : []

  return { artifacts, configs, runs, restores }
}

function mapProjectBackupRows(
  rows: Awaited<ReturnType<typeof listProjectBackupRows>>,
  projectEnvironments: ProjectContext['environments'],
) {
  const artifactsByRunId = new Map<
    string,
    Array<typeof backupArtifacts.$inferSelect>
  >()
  for (const artifact of rows.artifacts) {
    const artifacts = artifactsByRunId.get(artifact.backupRunId) ?? []
    artifacts.push(artifact)
    artifactsByRunId.set(artifact.backupRunId, artifacts)
  }

  return {
    backupRestores: rows.restores.map((restore) => ({
      ...restore,
      artifacts: parseRestoreContents(restore.artifacts),
      status:
        restore.status === 'abandoned' ? ('failed' as const) : restore.status,
      createdAt: restore.createdAt.toISOString(),
      startedAt: restore.startedAt?.toISOString() ?? null,
      finishedAt: restore.finishedAt?.toISOString() ?? null,
    })),
    backupConfigs: rows.configs.map(mapBackupConfig),
    backupRuns: rows.runs.map((run) =>
      mapBackupRun(
        run,
        projectEnvironments,
        artifactsByRunId.get(run.backupRun.id) ?? [],
      ),
    ),
  }
}

const deploymentSummarySelection = {
  deployment: {
    id: deployments.id,
    serverId: deployments.serverId,
    status: deployments.status,
    phase: deployments.phase,
    trigger: deployments.trigger,
    gitSha: deployments.gitSha,
    gitBranch: deployments.gitBranch,
    repoFullName: deployments.repoFullName,
    commitMeta: deployments.commitMeta,
    errorMessage: deployments.errorMessage,
    createdAt: deployments.createdAt,
    startedAt: deployments.startedAt,
    finishedAt: deployments.finishedAt,
  },
  environment: {
    name: environments.name,
    slug: environments.slug,
    color: environments.color,
  },
  project: { id: projects.id, name: projects.name },
  server: {
    id: servers.id,
    name: servers.name,
    status: servers.status,
    lastSeenAt: servers.lastSeenAt,
  },
  deploymentAlias: { hostname: aliases.hostname, https: aliases.https },
  serving:
    sql<boolean>`exists(select 1 from aliases as live_alias where live_alias.environment_id = ${deployments.environmentId} and live_alias.type = 'environment' and live_alias.deployment_id = ${deployments.id})`.mapWith(
      Boolean,
    ),
}

async function listProjectDeployments(projectId: string) {
  const rows = await db
    .select(deploymentSummarySelection)
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .leftJoin(servers, eq(servers.id, deployments.serverId))
    .leftJoin(
      aliases,
      and(
        eq(aliases.deploymentId, deployments.id),
        eq(aliases.type, 'deployment'),
      ),
    )
    .where(eq(environments.projectId, projectId))
    .orderBy(desc(deployments.createdAt))
    .limit(20)

  return rows.map(mapDeployment)
}

export async function listTeamDeployments({
  teamId,
  limit = 20,
}: {
  teamId: string
  limit?: number
}): Promise<Array<DeploymentSummary>> {
  const deploymentRows = await db
    .select(deploymentSummarySelection)
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .leftJoin(servers, eq(servers.id, deployments.serverId))
    .leftJoin(
      aliases,
      and(
        eq(aliases.deploymentId, deployments.id),
        eq(aliases.type, 'deployment'),
      ),
    )
    .where(and(eq(projects.teamId, teamId), eq(projects.status, 'active')))
    .orderBy(desc(deployments.createdAt))
    .limit(limit)

  return deploymentRows.map((deploymentRow) => mapDeployment(deploymentRow))
}

export async function getDeploymentSectionContext({
  userId,
  teamSlug,
  projectName,
  deploymentId,
}: {
  userId: string
  teamSlug: string
  projectName: string
  deploymentId: string
}): Promise<DeploymentSectionContext> {
  const row = await requireProjectIdentity({ userId, teamSlug, projectName })
  const [deploymentRows, latestDeployments, visitAliases] = await Promise.all([
    db
      .select(deploymentSummarySelection)
      .from(deployments)
      .innerJoin(environments, eq(environments.id, deployments.environmentId))
      .innerJoin(projects, eq(projects.id, environments.projectId))
      .leftJoin(servers, eq(servers.id, deployments.serverId))
      .leftJoin(
        aliases,
        and(
          eq(aliases.deploymentId, deployments.id),
          eq(aliases.type, 'deployment'),
        ),
      )
      .where(
        and(eq(deployments.id, deploymentId), eq(projects.id, row.project.id)),
      )
      .limit(1),
    listProjectDeployments(row.project.id),
    db
      .select({
        type: aliases.type,
        hostname: aliases.hostname,
        https: aliases.https,
      })
      .from(aliases)
      .where(
        and(
          eq(aliases.projectId, row.project.id),
          eq(aliases.deploymentId, deploymentId),
        ),
      ),
  ])
  const deploymentRow = deploymentRows.at(0)

  if (!deploymentRow) {
    throw new PublicError('DEPLOYMENT_NOT_FOUND')
  }

  return {
    projectId: row.project.id,
    latestDeployments,
    deployment: mapDeployment(deploymentRow),
    visitAliases,
  }
}

export async function getDeploymentLogsContext({
  deploymentId,
  projectName,
  teamSlug,
  userId,
}: {
  deploymentId: string
  projectName: string
  teamSlug: string
  userId: string
}) {
  const rows = await db
    .select({ id: deployments.id, projectId: environments.projectId })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, userId)),
    )
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(projects.slug, projectName),
        eq(projects.status, 'active'),
        eq(teams.slug, teamSlug),
        eq(teams.status, 'active'),
      ),
    )
    .limit(1)

  const deployment = rows[0]
  if (!deployment) throw new PublicError('DEPLOYMENT_NOT_FOUND')
  const logs = await readProjectDeploymentLogs(
    { projectId: deployment.projectId, deploymentId },
    1_000,
  )

  return logs.reverse().map((log) => ({
    ...log,
    createdAt: log.createdAt.toISOString(),
  }))
}

export async function getProjectLogsSectionContext({
  userId,
  teamSlug,
  projectName,
  branch,
  date,
  deploymentId,
  environmentId,
  keyword,
}: {
  userId: string
  teamSlug: string
  projectName: string
  branch?: string | null
  date?: string | null
  deploymentId?: string | null
  environmentId?: string | null
  keyword?: string | null
}): Promise<ProjectLogsSectionContext> {
  const row = await requireProjectIdentity({ userId, teamSlug, projectName })
  const normalizedBranch = branch?.trim() || null
  const normalizedDate = date?.trim() || null
  const normalizedDeploymentId = deploymentId?.trim() || null
  const normalizedEnvironmentId = environmentId?.trim() || null
  const normalizedKeyword = keyword?.trim() || null

  const since = getDatePresetStart(normalizedDate)
  const deploymentLogsQuery = readProjectDeploymentLogs({
    projectId: row.project.id,
    branch: normalizedBranch,
    deploymentId: normalizedDeploymentId,
    environmentId: normalizedEnvironmentId,
    keyword: normalizedKeyword,
    since,
  })
  const runtimeLogsQuery = normalizedDeploymentId
    ? Promise.resolve([])
    : readProjectRuntimeLogs({
        projectId: row.project.id,
        branch: normalizedBranch,
        environmentId: normalizedEnvironmentId,
        keyword: normalizedKeyword,
        since,
      })
  const [
    projectDeployments,
    deploymentLogRows,
    runtimeLogRows,
    deploymentLogExists,
    runtimeLogExists,
  ] = await Promise.all([
    listProjectDeployments(row.project.id),
    deploymentLogsQuery,
    runtimeLogsQuery,
    projectHasDeploymentLogs(row.project.id),
    projectHasRuntimeLogs(row.project.id),
  ])
  const logs: Array<ProjectLogEntry> = [
    ...deploymentLogRows.map((log) => ({
      source: 'deployment' as const,
      deploymentId: log.deploymentId,
      runtimeId: null,
      service: null,
      stream: log.stream,
      seq: log.seq,
      content: log.content,
      createdAt: log.createdAt.toISOString(),
    })),
    ...runtimeLogRows.map((log, index) => ({
      source: 'runtime' as const,
      deploymentId: null,
      runtimeId: log.runtimeId,
      service: log.service,
      stream: 'runtime',
      seq: index + 1,
      content: log.content,
      createdAt: log.createdAt.toISOString(),
    })),
  ]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    )
    .slice(0, 200)

  return {
    projectId: row.project.id,
    deployments: projectDeployments,
    logs,
    hasAnyLogs: deploymentLogExists || runtimeLogExists,
    filters: {
      branch: normalizedBranch,
      date: normalizedDate,
      deploymentId: normalizedDeploymentId,
      environmentId: normalizedEnvironmentId,
      keyword: normalizedKeyword,
    },
  }
}

function getDatePresetStart(preset: string | null) {
  if (!preset) {
    return null
  }

  const now = new Date()

  if (preset === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }

  const hours =
    preset === '24h'
      ? 24
      : preset === '7d'
        ? 24 * 7
        : preset === '30d'
          ? 24 * 30
          : null

  if (hours == null) {
    return null
  }

  return new Date(now.getTime() - hours * 60 * 60 * 1000)
}

function mapProject(
  project: typeof projects.$inferSelect,
): ProjectContext['project'] {
  const runtimeConfig = requireProjectRuntimeConfig(project.runtimeConfig)
  return {
    settingsVersion: project.settingsVersion,
    id: project.id,
    name: project.name,
    githubInstallationId: project.githubInstallationId,
    githubRepoId: project.githubRepoId,
    githubRepo: project.githubRepo,
    defaultServerId: project.defaultServerId,
    avatarUrl: project.avatarPath,
    runtimeConfig,
    color: getResourceColor(project.id),
  }
}

function parseStoredComposeMetadata(value: unknown) {
  if (!value || typeof value !== 'object') return null

  const metadata = value as Partial<ProjectComposeMetadata>
  if (
    !Array.isArray(metadata.services) ||
    !Array.isArray(metadata.volumes) ||
    !Array.isArray(metadata.warnings)
  ) {
    return null
  }

  return value as ProjectComposeMetadata
}

function parseRestoreContents(value: unknown) {
  const rows = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(rows)) return []
  return rows
    .filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        ['volume', 'database'].includes(item.type),
    )
    .map((item) => ({
      artifactId: item.id as string,
      type: item.type as 'volume' | 'database',
      targetVolume:
        typeof item.targetVolume === 'string' ? item.targetVolume : undefined,
      targetService:
        typeof item.targetService === 'string' ? item.targetService : undefined,
    }))
}

// Resolve only after joining current membership; the public opaque ID grants no access.
export async function resolveUnavailableDeployment(
  userId: string,
  deploymentId: string,
) {
  const [row] = await db
    .select({ teamSlug: teams.slug, projectName: projects.slug })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(
      projects,
      and(
        eq(projects.id, environments.projectId),
        eq(projects.status, 'active'),
      ),
    )
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, userId)),
    )
    .where(eq(deployments.id, deploymentId))
    .limit(1)
  if (!row) throw new PublicError('DEPLOYMENT_NOT_FOUND')
  return row
}
