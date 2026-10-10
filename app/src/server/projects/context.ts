import { listBackupStorage } from '@/server/backups/storage'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { db } from '@/server/db'
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
} from '@/server/db/schema'
import { readProjectRuntimeLogs, projectHasRuntimeLogs } from './runtime-logs'
import {
  readProjectDeploymentLogs,
  projectHasDeploymentLogs,
} from './deployment-logs'
import { getResourceColor } from '@/server/resources/color'
import { getUserContext } from '@/server/teams/service'
import { listTeamProjects, listTeamServers } from '@/server/teams/queries'
import { requireProjectRuntimeConfig } from './runtime-config'
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
}: {
  userId: string
  teamSlug: string
  projectName: string
}) {
  const rows = await db
    .select({
      team: {
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        image: teams.avatarPath,
        role: teamMembers.role,
      },
      project: projects,
      environment: environments,
      server: servers,
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
    throw new Error('Project not found.')
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
    requireProjectIdentity({ userId, teamSlug, projectName }),
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
    db.select().from(aliases).where(eq(aliases.projectId, row.project.id)),
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
  const projectEnvironments = environmentRows.map((environment) =>
    mapEnvironmentConfig(environment, row.project.defaultServerId),
  )
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
  const row = await requireProjectIdentity({ userId, teamSlug, projectName })

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

  if (scope === 'settings') {
    const domainRows = await db
      .select()
      .from(domains)
      .where(eq(domains.projectId, row.project.id))

    return {
      scope,
      projectId: row.project.id,
      composeMetadata: parseStoredComposeMetadata(row.project.composeMetadata),
      domains: mapProjectDomains(domainRows),
      envVars: readProjectEnvVars(row.project),
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
        backupRunId: sql<string>`json_extract(${agentJobs.payload}, '$.backupRunId')`,
        environmentId: sql<string>`json_extract(${agentJobs.payload}, '$.environmentId')`,
        status: agentJobs.status,
        errorMessage: agentJobs.errorMessage,
        createdAt: agentJobs.createdAt,
        startedAt: agentJobs.claimedAt,
        finishedAt: agentJobs.finishedAt,
      })
      .from(agentJobs)
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

async function listProjectDeployments(projectId: string) {
  const rows = await db
    .select({
      deployment: deployments,
      environment: environments,
      project: projects,
      server: servers,
      deploymentAlias: aliases,
    })
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
    .select({
      deployment: deployments,
      environment: environments,
      project: projects,
      server: servers,
      deploymentAlias: aliases,
    })
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
  const [deploymentRows, latestDeployments] = await Promise.all([
    db
      .select({
        deployment: deployments,
        environment: environments,
        project: projects,
        server: servers,
        deploymentAlias: aliases,
      })
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
  ])
  const deploymentRow = deploymentRows.at(0)

  if (!deploymentRow) {
    throw new Error('Deployment not found.')
  }

  return {
    projectId: row.project.id,
    latestDeployments,
    deployment: mapDeployment(deploymentRow),
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
  if (!deployment) throw new Error('Deployment not found.')
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
