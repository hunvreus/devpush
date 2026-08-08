import { and, asc, desc, eq, gte, ilike, inArray, ne, sql } from 'drizzle-orm'
import { parse as parseYaml } from 'yaml'

import { db } from '@/server/db'
import { config } from '@/server/config'
import { enqueueProjectDeprovisionJobs } from '@/server/agents/cleanup'
import { failStaleRunningDeploymentsForServer } from '@/server/agents/jobs'
import {
  aliases,
  backupArtifacts,
  backupConfigs,
  backupRuns,
  agentRuntimeObservations,
  deployments,
  deploymentLogs,
  domains,
  environments,
  projects,
  runtimeLogs,
  servers,
} from '@/server/db/schema'
import {
  detectComposePath,
  createInstallationAccessToken,
  getBranchHeadCommit,
  getGitHubAccount,
  getGitHubRepository,
  getGitHubAppInstallUrl,
  getRepositoryFileText,
  isGitHubAppConfigured,
  listBranchCommits,
  listRepositoryBranches,
  listInstallationRepositories,
  listUserInstallations,
  upsertGitHubInstallation,
} from '@/server/github/service'
import {
  getUserContext,
  listTeamProjects,
  listTeamServers,
  requireTeam,
} from '@/server/teams/service'
import { canDeleteProject } from '@/server/teams/delete-policy'
import { removePublicFile, resolveAvatarUpdate } from '@/server/uploads/avatar'
import type {
  ProjectSummary,
  ServerSummary,
  TeamSummary,
  UserContext,
} from '@/server/teams/service'
import {
  buildComposeProjectName,
  encryptDeploymentEnvVars,
  parseDeploymentConfig,
  toDeploymentCommitMeta,
} from './deployment-config'
import {
  getEnvironmentForBranch,
  groupBranchesByEnvironment,
} from './environment-branches'
import type {
  DeploymentCommitMeta,
  DeploymentConfig,
  DeploymentEnvVar,
} from './deployment-config'
import type {
  BackupDatabaseDump,
  BackupDestination,
  BackupRetentionPolicy,
  BackupVolumeSelection,
} from '@/server/backups/service'
import {
  backupRetentionSchema,
  queueEnvironmentBackup,
  queueBackupRestoreJob,
} from '@/server/backups/service'
import { encryptSecret } from '@/server/secrets/crypto'
import { getResourceColor } from '@/server/resources/color'
import { getEffectiveServerStatus } from '@/server/servers/status'
import type { ServerStatus } from '@/server/servers/status'

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const projectMachineNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/
const projectMachineNameError =
  'Project names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.'

export type RepositorySelectionContext = {
  github:
    | {
        connected: true
        login: string
        appConfigured: boolean
        installUrl: string | null
        installations: Array<{
          id: number
          accountLogin: string
          accountType: string
          repositorySelection: string
        }>
        repositories: Array<{
          id: number
          installationId: number
          name: string
          fullName: string
          owner: string
          private: boolean
          defaultBranch: string
          updatedAt: string
          permissions: {
            push: boolean
          }
        }>
      }
    | {
        connected: false
        login: null
        appConfigured: boolean
        installUrl: string | null
        installations: []
        repositories: []
      }
}

export type CreatedProject = {
  id: string
  name: string
  githubRepo: string
  composePath: string | null
}

export type ProjectPublicRoute = {
  host: string
  service: string
  port: number
  path: string
  https: boolean
  stripPrefix: boolean
}

export type ProjectRoute = {
  service: string
  port: number
  path: string
  stripPrefix: boolean
}

export type ProjectDomain = {
  id: string
  host: string
  environmentId: string
  basePath: string | null
  https: boolean
  status: 'pending' | 'active' | 'disabled' | 'failed'
}

export type ProjectEnvironmentVariable = {
  key: string
  value: string
  environment?: string
}

export type ProjectEnvironmentConfig = {
  id: string
  name: string
  slug: string
  branch: string
  color: string
  position: number
  status: 'active' | 'deleted'
  effectiveServerId: string | null
  serverId: string | null
}

export type ProjectComposeMetadata = {
  services: Array<string>
  volumes: Array<string>
}

export type ProjectBackupConfig = {
  id: string
  name: string
  environmentId: string
  enabled: boolean
  schedule: ProjectBackupSchedule
  destination: BackupDestination
  retention: BackupRetentionPolicy
  volumes: BackupVolumeSelection
  databaseDumps: Array<BackupDatabaseDump>
}

type BackupDestinationInput = BackupDestination & {
  clearSecretAccessKey?: boolean
  secretAccessKey?: string
}

export type ProjectBackupSchedule = {
  cron: string
}

export type ProjectBackupRun = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  environmentId: string
  environmentName: string
  environmentColor: string
  serverId: string | null
  serverName: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  artifacts: Array<ProjectBackupArtifact>
}

export type ProjectBackupArtifact = {
  id: string
  type: 'manifest' | 'volume' | 'database'
  storage: 'local' | 'remote'
  objectKey: string
  checksumSha256: string
  sizeBytes: number
  createdAt: string
}

export type DeploymentSummary = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  phase: string | null
  trigger: 'user' | 'webhook' | 'api' | 'rollback'
  gitSha: string
  gitBranch: string
  githubRepo: string
  defaultHost: string | null
  defaultRouteHttps: boolean
  commitMessage: string | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  environmentName: string
  environmentSlug: string
  environmentColor: string
  serverId: string | null
  serverName: string
  serverStatus: ServerStatus
  projectName: string
  projectColor: ReturnType<typeof getResourceColor>
}

export type ProjectContext = {
  userContext: UserContext
  team: TeamSummary
  project: {
    id: string
    name: string
    githubInstallationId: number | null
    githubRepoId: number | null
    githubRepo: string
    defaultServerId: string | null
    avatarUrl: string | null
    composePath: string | null
    releaseCommand: string | null
    releaseService: string | null
    readinessPath: string | null
    color: ReturnType<typeof getResourceColor>
  }
  teamProjects: Array<ProjectSummary>
  routes: Array<ProjectRoute>
  composeMetadata: ProjectComposeMetadata | null
  domains: Array<ProjectDomain>
  envVars: Array<ProjectEnvironmentVariable>
  backupConfigs: Array<ProjectBackupConfig>
  backupRuns: Array<ProjectBackupRun>
  environment: {
    id: string
    name: string
    slug: string
    branch: string
    color: string
    position: number
    defaultHost: string | null
    serverId: string | null
    serverName: string | null
    serverStatus: ServerStatus | null
    envVars: Array<ProjectEnvironmentVariable>
    publicRoutes: Array<ProjectPublicRoute>
    runtime: {
      observedAt: string
      services: Array<{
        name: string
        containerName: string
        state: string
        health: string | null
        restartCount: number
        startedAt: string | null
        exitCode: number
      }>
    } | null
  }
  environments: Array<ProjectEnvironmentConfig>
  deployments: Array<DeploymentSummary>
  servers: Array<ServerSummary>
}

export type DeploymentContext = {
  userContext: UserContext
  team: TeamSummary
  project: ProjectContext['project']
  teamProjects: Array<ProjectSummary>
  latestDeployments: Array<DeploymentSummary>
  environment: ProjectContext['environment']
  servers: Array<ServerSummary>
  deployment: DeploymentSummary
  logs: Array<{
    seq: number
    stream: string
    content: string
    createdAt: string
  }>
}

export type ProjectLogEntry = {
  source: 'deployment' | 'runtime'
  deploymentId: string | null
  runtimeId: string | null
  service: string | null
  stream: string
  seq: number
  content: string
  createdAt: string
}

export type ProjectLogsContext = ProjectContext & {
  logs: Array<ProjectLogEntry>
  hasAnyLogs: boolean
  filters: {
    branch: string | null
    date: string | null
    deploymentId: string | null
    environmentId: string | null
    keyword: string | null
  }
}

export async function getRepositorySelection({
  userId,
  teamSlug,
}: {
  userId: string
  teamSlug: string
}): Promise<RepositorySelectionContext> {
  await requireTeam(userId, teamSlug)

  const githubAccount = await getGitHubAccount(userId)

  if (!githubAccount) {
    return {
      github: {
        connected: false,
        login: null,
        appConfigured: isGitHubAppConfigured(),
        installUrl: getGitHubAppInstallUrl(),
        installations: [],
        repositories: [],
      },
    }
  }

  const installations = await listUserInstallations(githubAccount.accessToken)

  await Promise.all(installations.map(upsertGitHubInstallation))

  return {
    github: {
      connected: true,
      login: githubAccount.login,
      appConfigured: isGitHubAppConfigured(),
      installUrl: getGitHubAppInstallUrl(),
      installations,
      repositories: [],
    },
  }
}

export async function listRepositorySelectionRepositories({
  userId,
  teamSlug,
  installationId,
}: {
  userId: string
  teamSlug: string
  installationId: number
}) {
  await requireTeam(userId, teamSlug)

  const githubAccount = await getGitHubAccount(userId)

  if (!githubAccount) {
    throw new Error(
      'Connect your GitHub account before selecting a repository.',
    )
  }

  const installations = await listUserInstallations(githubAccount.accessToken)
  const installation = installations.find((item) => item.id === installationId)

  if (!installation) {
    throw new Error('Install the GitHub App for this account to continue.')
  }

  await upsertGitHubInstallation(installation)

  const repositories = (
    await listInstallationRepositories({
      accessToken: githubAccount.accessToken,
      installationId,
    })
  ).filter((repo) => repo.permissions.push)

  return repositories
}

export async function createProjectFromGitHub({
  composePath: requestedComposePath,
  envVars,
  userId,
  teamSlug,
  projectName,
  repoFullName,
  installationId,
  serverId,
}: {
  userId: string
  teamSlug: string
  projectName: string
  repoFullName: string
  installationId: number
  serverId: string | null
  composePath?: string
  envVars?: Array<ProjectEnvironmentVariable>
}): Promise<CreatedProject> {
  const team = await requireTeam(userId, teamSlug)
  const githubAccount = await getGitHubAccount(userId)

  const serverRows = serverId
    ? await db
        .select({
          id: servers.id,
          publicAddress: servers.publicAddress,
          status: servers.status,
          lastSeenAt: servers.lastSeenAt,
        })
        .from(servers)
        .where(and(eq(servers.id, serverId), eq(servers.teamId, team.id)))
        .limit(1)
    : []
  const server = serverRows.at(0) ?? null

  if (serverId && !server) {
    throw new Error('Select a valid server.')
  }

  if (!githubAccount) {
    throw new Error('Connect GitHub before creating a project.')
  }

  const installations = await listUserInstallations(githubAccount.accessToken)
  const installation = installations.find((item) => item.id === installationId)

  if (!installation) {
    throw new Error('Install the GitHub app for this repository to continue.')
  }

  await upsertGitHubInstallation(installation)

  const repo = await getGitHubRepository(
    githubAccount.accessToken,
    repoFullName,
    installationId,
  )
  const installationRepositories = await listInstallationRepositories({
    accessToken: githubAccount.accessToken,
    installationId,
  })

  if (
    !installationRepositories.some(
      (installationRepo) => installationRepo.id === repo.id,
    )
  ) {
    throw new Error('Install the GitHub app for this repository to continue.')
  }

  if (!repo.permissions.push) {
    throw new Error(
      'You need push access to create a project from this repository.',
    )
  }

  const composePath = await detectComposePath({
    accessToken: githubAccount.accessToken,
    repo: repo.fullName,
    ref: repo.defaultBranch,
  })

  const projectComposePath =
    composePath ?? (requestedComposePath?.trim() || null)
  const projectEnvVars = envVars ?? []
  const slug = projectName.trim()
  validateProjectMachineName(slug)

  return db.transaction(async (tx) => {
    const projectId = crypto.randomUUID()
    const productionEnvironmentId = crypto.randomUUID()
    const scopedProjectEnvVars = projectEnvVars.map((envVar) => ({
      ...envVar,
      environment:
        envVar.environment === 'production'
          ? productionEnvironmentId
          : envVar.environment,
    }))
    await requireAvailableProjectMachineName(tx, team.id, slug)
    const requestedDefaultHost = server
      ? buildDefaultHostForProject({
          projectName: slug,
          serverPublicAddress: server.publicAddress,
        })
      : null
    const defaultHost = requestedDefaultHost
      ? await resolveAvailableAliasHostname({
          hostname: requestedDefaultHost,
          uniquenessKey: projectId,
        })
      : null

    await tx.insert(projects).values({
      id: projectId,
      teamId: team.id,
      slug,
      name: slug,
      githubRepoId: repo.id,
      githubRepo: repo.fullName,
      githubInstallationId: installationId,
      defaultServerId: server?.id ?? null,
      routes: [{ path: '/', service: 'web', port: 3000, stripPrefix: false }],
      envVars: scopedProjectEnvVars,
      composePath: projectComposePath,
    })

    await tx.insert(environments).values({
      id: productionEnvironmentId,
      projectId,
      serverId: null,
      name: 'Production',
      slug: 'production',
      branch: repo.defaultBranch,
      isProduction: true,
      position: 0,
      color: 'blue',
      status: 'active',
      runtimeId: buildComposeProjectName({
        projectId,
        environmentId: productionEnvironmentId,
      }),
    })

    if (defaultHost) {
      await tx.insert(aliases).values({
        id: crypto.randomUUID(),
        projectId,
        environmentId: productionEnvironmentId,
        hostname: defaultHost,
        type: 'environment',
        https: generatedAliasUsesHttps(server?.publicAddress ?? null),
      })
    }

    return {
      id: projectId,
      name: slug,
      githubRepo: repo.fullName,
      composePath: projectComposePath,
    }
  })
}

export async function getProjectContext({
  userId,
  teamSlug,
  projectName,
}: {
  userId: string
  teamSlug: string
  projectName: string
}): Promise<ProjectContext> {
  const team = await requireTeam(userId, teamSlug)
  const userContext = await getUserContext(userId)
  const rows = await db
    .select({
      project: projects,
      environment: environments,
      server: servers,
    })
    .from(projects)
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
        eq(projects.teamId, team.id),
        eq(projects.slug, projectName),
        eq(projects.status, 'active'),
      ),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new Error('Project not found.')
  }

  if (row.server) {
    await failStaleRunningDeploymentsForServer(row.server.id)
  }

  const deploymentRows = await db
    .select({
      deployment: deployments,
      environment: environments,
      project: projects,
      server: servers,
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .leftJoin(servers, eq(servers.id, deployments.serverId))
    .where(eq(environments.projectId, row.project.id))
    .orderBy(desc(deployments.createdAt))
    .limit(20)

  const projectEnvVars = normalizeEnvVars(row.project.envVars)
  const [
    teamServers,
    environmentRows,
    aliasRows,
    domainRows,
    backupConfigRows,
    backupRunRows,
    runtimeObservationRows,
  ] = await Promise.all([
    listTeamServers(team.id),
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
    db.select().from(domains).where(eq(domains.projectId, row.project.id)),
    db
      .select()
      .from(backupConfigs)
      .where(eq(backupConfigs.projectId, row.project.id)),
    db
      .select({
        backupRun: backupRuns,
        environment: environments,
        server: servers,
      })
      .from(backupRuns)
      .innerJoin(environments, eq(environments.id, backupRuns.environmentId))
      .leftJoin(servers, eq(servers.id, backupRuns.serverId))
      .where(eq(backupRuns.projectId, row.project.id))
      .orderBy(desc(backupRuns.createdAt))
      .limit(50),
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
              eq(agentRuntimeObservations.runtimeId, row.environment.runtimeId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ])
  const backupRunIds = backupRunRows.map((item) => item.backupRun.id)
  const backupArtifactRows =
    backupRunIds.length > 0
      ? await db
          .select()
          .from(backupArtifacts)
          .where(inArray(backupArtifacts.backupRunId, backupRunIds))
      : []
  const backupArtifactsByRunId = new Map<
    string,
    Array<typeof backupArtifacts.$inferSelect>
  >()
  for (const artifact of backupArtifactRows) {
    const artifacts = backupArtifactsByRunId.get(artifact.backupRunId) ?? []
    artifacts.push(artifact)
    backupArtifactsByRunId.set(artifact.backupRunId, artifacts)
  }
  const projectEnvironments = environmentRows.map((environment) =>
    mapEnvironmentConfig(environment, row.project.defaultServerId),
  )
  const productionEnvironment = getProductionEnvironment(projectEnvironments)
  const productionEnvironmentRow =
    environmentRows.find(
      (environment) => environment.id === productionEnvironment.id,
    ) ?? row.environment
  const productionServerId =
    productionEnvironmentRow.serverId ?? row.project.defaultServerId
  const productionServer =
    teamServers.find((server) => server.id === productionServerId) ?? null
  const projectRoutes = normalizeProjectRoutes(row.project.routes)
  const productionAliases = aliasRows.filter(
    (alias) =>
      alias.environmentId === productionEnvironment.id &&
      alias.type !== 'deployment',
  )
  const productionDomains = domainRows.filter(
    (domain) =>
      domain.environmentId === productionEnvironment.id &&
      (domain.status === 'pending' || domain.status === 'active'),
  )
  const productionPublicRoutes = expandPublicRoutesFromHostnames(
    projectRoutes,
    toRouteHostnames(productionAliases, productionDomains),
  )
  const composeMetadata = await getProjectComposeMetadata({
    project: row.project,
    ref: productionEnvironment.branch,
  })
  const productionDefaultHost =
    productionAliases.find((alias) => alias.type === 'environment')?.hostname ??
    null

  return {
    userContext,
    team,
    project: mapProject(row.project),
    teamProjects: await listTeamProjects(team.id),
    routes: projectRoutes,
    composeMetadata,
    domains: mapProjectDomains(domainRows),
    envVars: projectEnvVars,
    backupConfigs: backupConfigRows.map(mapBackupConfig),
    backupRuns: backupRunRows.map((backupRunRow) =>
      mapBackupRun(
        backupRunRow,
        projectEnvironments,
        backupArtifactsByRunId.get(backupRunRow.backupRun.id) ?? [],
      ),
    ),
    environment: {
      ...mapEnvironment(row.environment, row.server),
      defaultHost: productionDefaultHost,
      color: productionEnvironment.color,
      serverId: productionServer?.id ?? null,
      serverName: productionServer?.name ?? null,
      serverStatus: productionServer?.status ?? null,
      envVars: getEnvVarsForEnvironment(
        projectEnvVars,
        productionEnvironment.id,
      ),
      publicRoutes: productionPublicRoutes,
      runtime: mapRuntimeObservation(runtimeObservationRows.at(0) ?? null),
    },
    environments: projectEnvironments,
    deployments: deploymentRows.map((deploymentRow) =>
      mapDeployment(deploymentRow),
    ),
    servers: teamServers,
  }
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
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .leftJoin(servers, eq(servers.id, deployments.serverId))
    .where(and(eq(projects.teamId, teamId), eq(projects.status, 'active')))
    .orderBy(desc(deployments.createdAt))
    .limit(limit)

  return deploymentRows.map((deploymentRow) => mapDeployment(deploymentRow))
}

export async function getDeploymentContext({
  userId,
  teamSlug,
  projectName,
  deploymentId,
}: {
  userId: string
  teamSlug: string
  projectName: string
  deploymentId: string
}): Promise<DeploymentContext> {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const deploymentRows = await db
    .select({
      deployment: deployments,
      environment: environments,
      project: projects,
      server: servers,
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .leftJoin(servers, eq(servers.id, deployments.serverId))
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(projects.id, context.project.id),
      ),
    )
    .limit(1)
  const deploymentRow = deploymentRows.at(0)

  if (!deploymentRow) {
    throw new Error('Deployment not found.')
  }

  const deployment = mapDeployment(deploymentRow)

  const logs = await db
    .select({
      seq: deploymentLogs.seq,
      stream: deploymentLogs.stream,
      content: deploymentLogs.content,
      createdAt: deploymentLogs.createdAt,
    })
    .from(deploymentLogs)
    .where(eq(deploymentLogs.deploymentId, deploymentId))
    .orderBy(deploymentLogs.seq)

  return {
    userContext: context.userContext,
    team: context.team,
    project: context.project,
    teamProjects: context.teamProjects,
    latestDeployments: context.deployments,
    environment: context.environment,
    servers: context.servers,
    deployment,
    logs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  }
}

export async function getProjectLogsContext({
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
}): Promise<ProjectLogsContext> {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const deploymentLogConditions = [
    eq(environments.projectId, context.project.id),
  ]
  const runtimeLogConditions = [eq(environments.projectId, context.project.id)]
  const normalizedBranch = branch?.trim() || null
  const normalizedDate = date?.trim() || null
  const normalizedDeploymentId = deploymentId?.trim() || null
  const normalizedEnvironmentId = environmentId?.trim() || null
  const normalizedKeyword = keyword?.trim() || null

  if (normalizedBranch) {
    deploymentLogConditions.push(eq(deployments.gitBranch, normalizedBranch))
    runtimeLogConditions.push(eq(environments.branch, normalizedBranch))
  }

  if (normalizedDeploymentId) {
    deploymentLogConditions.push(
      eq(deploymentLogs.deploymentId, normalizedDeploymentId),
    )
  }

  if (normalizedEnvironmentId) {
    deploymentLogConditions.push(
      eq(deployments.environmentId, normalizedEnvironmentId),
    )
    runtimeLogConditions.push(eq(environments.id, normalizedEnvironmentId))
  }

  if (normalizedKeyword) {
    deploymentLogConditions.push(
      ilike(deploymentLogs.content, `%${normalizedKeyword}%`),
    )
    runtimeLogConditions.push(
      ilike(runtimeLogs.content, `%${normalizedKeyword}%`),
    )
  }

  const since = getDatePresetStart(normalizedDate)

  if (since) {
    deploymentLogConditions.push(gte(deploymentLogs.createdAt, since))
    runtimeLogConditions.push(gte(runtimeLogs.observedAt, since))
  }

  const deploymentLogRows = await db
    .select({
      deploymentId: deploymentLogs.deploymentId,
      stream: deploymentLogs.stream,
      seq: deploymentLogs.seq,
      content: deploymentLogs.content,
      createdAt: deploymentLogs.createdAt,
    })
    .from(deploymentLogs)
    .innerJoin(deployments, eq(deployments.id, deploymentLogs.deploymentId))
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .where(and(...deploymentLogConditions))
    .orderBy(desc(deploymentLogs.createdAt), desc(deploymentLogs.seq))
    .limit(200)
  const runtimeLogRows = normalizedDeploymentId
    ? []
    : await db
        .select({
          runtimeId: runtimeLogs.runtimeId,
          service: runtimeLogs.service,
          content: runtimeLogs.content,
          createdAt: runtimeLogs.observedAt,
        })
        .from(runtimeLogs)
        .innerJoin(
          environments,
          and(
            eq(environments.serverId, runtimeLogs.serverId),
            eq(environments.runtimeId, runtimeLogs.runtimeId),
          ),
        )
        .where(and(...runtimeLogConditions))
        .orderBy(desc(runtimeLogs.observedAt))
        .limit(200)
  const [deploymentLogExists, runtimeLogExists] = await Promise.all([
    db
      .select({ deploymentId: deploymentLogs.deploymentId })
      .from(deploymentLogs)
      .innerJoin(deployments, eq(deployments.id, deploymentLogs.deploymentId))
      .innerJoin(environments, eq(environments.id, deployments.environmentId))
      .where(eq(environments.projectId, context.project.id))
      .limit(1),
    db
      .select({ id: runtimeLogs.id })
      .from(runtimeLogs)
      .innerJoin(
        environments,
        and(
          eq(environments.serverId, runtimeLogs.serverId),
          eq(environments.runtimeId, runtimeLogs.runtimeId),
        ),
      )
      .where(eq(environments.projectId, context.project.id))
      .limit(1),
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
    ...context,
    logs,
    hasAnyLogs: deploymentLogExists.length > 0 || runtimeLogExists.length > 0,
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

export async function updateProjectSettings({
  userId,
  teamSlug,
  currentProjectName,
  projectName,
  repoFullName,
  installationId,
  avatarDataUrl,
  deleteAvatar,
  composePath,
  releaseCommand,
  releaseService,
  readinessPath,
}: {
  userId: string
  teamSlug: string
  currentProjectName: string
  projectName: string
  repoFullName: string
  installationId: number | null
  avatarDataUrl?: string | null
  deleteAvatar?: boolean
  composePath: string
  releaseCommand: string | null
  releaseService: string | null
  readinessPath: string | null
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName: currentProjectName,
  })
  const nextProjectSlug = projectName.trim()
  validateProjectMachineName(nextProjectSlug)
  const repoUpdate = await resolveProjectRepositoryUpdate({
    userId,
    teamSlug,
    currentRepoFullName: context.project.githubRepo,
    currentInstallationId: context.project.githubInstallationId,
    currentRepoId: context.project.githubRepoId,
    repoFullName,
    installationId,
    composePath,
  })
  const avatarPath = await resolveAvatarUpdate({
    filePrefix: 'project',
    resourceId: context.project.id,
    currentAvatarPath: context.project.avatarUrl,
    avatarDataUrl,
    deleteAvatar: deleteAvatar ?? false,
  })
  const productionBranch =
    context.environments.find(
      (environment) => environment.slug === 'production',
    )?.branch ?? context.environments.at(0)?.branch
  if (releaseService && productionBranch) {
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, context.project.id))
      .limit(1)
    const currentProject = projectRows.at(0)

    if (!currentProject) {
      throw new Error('Project not found.')
    }

    const metadata = await getProjectComposeMetadata({
      project: {
        ...currentProject,
        slug: nextProjectSlug,
        name: nextProjectSlug,
        githubRepoId: repoUpdate.repoId,
        githubRepo: repoUpdate.repoFullName,
        githubInstallationId: repoUpdate.installationId,
        avatarPath,
        routes: context.routes,
        envVars: context.envVars,
        composePath,
        releaseCommand,
        releaseService,
        readinessPath,
      },
      ref: productionBranch,
    })

    if (!metadata?.services.includes(releaseService)) {
      throw new Error(
        `Release service "${releaseService}" is not defined in the Compose file.`,
      )
    }
  }
  const now = new Date()

  try {
    await db.transaction(async (tx) => {
      await requireAvailableProjectMachineName(
        tx,
        context.team.id,
        nextProjectSlug,
        context.project.id,
      )
      await tx
        .update(projects)
        .set({
          slug: nextProjectSlug,
          name: nextProjectSlug,
          githubRepoId: repoUpdate.repoId,
          githubRepo: repoUpdate.repoFullName,
          githubInstallationId: repoUpdate.installationId,
          avatarPath,
          composePath,
          releaseCommand,
          releaseService,
          readinessPath,
          updatedAt: now,
        })
        .where(eq(projects.id, context.project.id))
    })
  } catch (error) {
    if (avatarPath && avatarPath !== context.project.avatarUrl) {
      await removePublicFile(avatarPath)
    }

    throw error
  }

  return getProjectContext({ userId, teamSlug, projectName: nextProjectSlug })
}

export async function deleteProject({
  userId,
  teamSlug,
  projectName,
  confirmationName,
  removeDeployments = true,
}: {
  userId: string
  teamSlug: string
  projectName: string
  confirmationName: string
  removeDeployments?: boolean
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })

  if (!canDeleteProject(context.team.role)) {
    throw new Error('Only team owners and admins can delete projects.')
  }

  if (confirmationName !== context.project.name) {
    throw new Error('Type the project name to confirm deletion.')
  }

  const now = new Date()

  await db.transaction(async (tx) => {
    if (removeDeployments) {
      await enqueueProjectDeprovisionJobs(tx, {
        projectId: context.project.id,
        teamId: context.team.id,
        reason: 'Project deleted.',
      })
    }

    const environmentRows = await tx
      .select({ id: environments.id })
      .from(environments)
      .where(eq(environments.projectId, context.project.id))
    const environmentIds = environmentRows.map((environment) => environment.id)

    if (environmentIds.length > 0) {
      await tx
        .update(deployments)
        .set({
          status: 'canceled',
          phase: 'canceled',
          errorMessage: 'Canceled because the project was deleted.',
          finishedAt: now,
        })
        .where(
          and(
            inArray(deployments.environmentId, environmentIds),
            inArray(deployments.status, ['queued', 'running']),
          ),
        )
    }

    await tx.delete(aliases).where(eq(aliases.projectId, context.project.id))
    await tx.delete(domains).where(eq(domains.projectId, context.project.id))
    await tx
      .update(projects)
      .set({ status: 'deleted', updatedAt: now })
      .where(eq(projects.id, context.project.id))
  })
}

export async function updateProjectRoutes({
  userId,
  teamSlug,
  projectName,
  routes,
}: {
  userId: string
  teamSlug: string
  projectName: string
  routes: Array<ProjectRoute>
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const normalizedRoutes = normalizeProjectRoutes(routes)
  const routePaths = new Set(normalizedRoutes.map((route) => route.path))
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ routes: normalizedRoutes, updatedAt: now })
      .where(eq(projects.id, context.project.id))

    const domainRows = await tx
      .select()
      .from(domains)
      .where(eq(domains.projectId, context.project.id))

    for (const domain of domainRows) {
      if (domain.basePath && !routePaths.has(domain.basePath)) {
        await tx
          .update(domains)
          .set({ basePath: null, updatedAt: now })
          .where(eq(domains.id, domain.id))
      }
    }
  })

  return getProjectContext({ userId, teamSlug, projectName })
}

export async function updateProjectDomains({
  userId,
  teamSlug,
  projectName,
  domains: projectDomains,
}: {
  userId: string
  teamSlug: string
  projectName: string
  domains: Array<Omit<ProjectDomain, 'id' | 'status'>>
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const routePaths = new Set(context.routes.map((route) => route.path))
  const normalizedDomains = projectDomains.map((domain) => ({
    host: domain.host.trim().toLowerCase(),
    environmentId: domain.environmentId,
    basePath:
      domain.basePath && routePaths.has(domain.basePath)
        ? domain.basePath
        : null,
    https: domain.https,
  }))
  const duplicateHost = findDuplicate(
    normalizedDomains.map((domain) => domain.host),
  )

  if (duplicateHost) {
    throw new Error('Each domain can only be added once.')
  }

  const now = new Date()

  await db.transaction(async (tx) => {
    const conflictingAliases = await tx
      .select({ hostname: aliases.hostname })
      .from(aliases)
      .where(
        inArray(
          aliases.hostname,
          normalizedDomains.map((item) => item.host),
        ),
      )

    if (conflictingAliases.length > 0) {
      throw new Error('A custom domain cannot replace a generated alias.')
    }

    await tx.delete(domains).where(eq(domains.projectId, context.project.id))

    if (normalizedDomains.length > 0) {
      const values: Array<typeof domains.$inferInsert> = normalizedDomains.map(
        (domain) => ({
          id: crypto.randomUUID(),
          projectId: context.project.id,
          hostname: domain.host,
          environmentId: domain.environmentId,
          basePath: domain.basePath,
          https: domain.https,
          status: 'pending',
          updatedAt: now,
        }),
      )

      await tx.insert(domains).values(values)
    }
  })

  return getProjectContext({ userId, teamSlug, projectName })
}

async function resolveProjectRepositoryUpdate({
  userId,
  teamSlug,
  currentRepoFullName,
  currentInstallationId,
  currentRepoId,
  repoFullName,
  installationId,
  composePath,
}: {
  userId: string
  teamSlug: string
  currentRepoFullName: string
  currentInstallationId: number | null
  currentRepoId: number | null
  repoFullName: string
  installationId: number | null
  composePath: string
}) {
  if (
    repoFullName === currentRepoFullName &&
    installationId === currentInstallationId
  ) {
    return {
      repoId: currentRepoId,
      repoFullName: currentRepoFullName,
      installationId: currentInstallationId,
    }
  }

  if (!installationId) {
    throw new Error('Select a GitHub App installation for this repository.')
  }

  await requireTeam(userId, teamSlug)
  const githubAccount = await getGitHubAccount(userId)

  if (!githubAccount) {
    throw new Error('Connect GitHub before changing the repository.')
  }

  const installations = await listUserInstallations(githubAccount.accessToken)
  const installation = installations.find((item) => item.id === installationId)

  if (!installation) {
    throw new Error('Install the GitHub app for this repository to continue.')
  }

  await upsertGitHubInstallation(installation)

  const repo = await getGitHubRepository(
    githubAccount.accessToken,
    repoFullName,
    installationId,
  )
  const installationRepositories = await listInstallationRepositories({
    accessToken: githubAccount.accessToken,
    installationId,
  })

  if (
    !installationRepositories.some(
      (installationRepo) => installationRepo.id === repo.id,
    )
  ) {
    throw new Error('Install the GitHub app for this repository to continue.')
  }

  if (!repo.permissions.push) {
    throw new Error('You need push access to use this repository.')
  }

  const detectedComposePath = await detectComposePath({
    accessToken: githubAccount.accessToken,
    repo: repo.fullName,
    ref: repo.defaultBranch,
  })

  if (!detectedComposePath && composePath.trim() === '') {
    throw new Error('Set a Compose file path before changing repositories.')
  }

  return {
    repoId: repo.id,
    repoFullName: repo.fullName,
    installationId,
  }
}

export async function updateProjectEnvironments({
  userId,
  teamSlug,
  projectName,
  projectEnvironments,
  defaultServerId,
}: {
  userId: string
  teamSlug: string
  projectName: string
  projectEnvironments: Array<ProjectEnvironmentConfig>
  defaultServerId?: string | null
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const activeEnvironments = projectEnvironments.filter(
    (environment) => environment.status === 'active',
  )
  const production = activeEnvironments.find(
    (environment) => environment.slug === 'production',
  )

  if (!production) {
    throw new Error('Production environment is required.')
  }

  const duplicateSlug = findDuplicate(
    activeEnvironments.map((environment) => environment.slug),
  )

  if (duplicateSlug) {
    throw new Error(`Environment identifier "${duplicateSlug}" is duplicated.`)
  }

  const now = new Date()
  const effectiveDefaultServerId =
    defaultServerId === undefined
      ? context.project.defaultServerId
      : defaultServerId

  await db.transaction(async (tx) => {
    const [environmentRows, aliasRows] = await Promise.all([
      tx
        .select()
        .from(environments)
        .where(eq(environments.projectId, context.project.id)),
      tx
        .select()
        .from(aliases)
        .where(eq(aliases.projectId, context.project.id)),
    ])
    const environmentById = new Map(
      environmentRows.map((environment) => [environment.id, environment]),
    )
    const environmentBySlug = new Map(
      environmentRows.map((environment) => [environment.slug, environment]),
    )
    const reconciledEnvironments = activeEnvironments.map((environment) => {
      const existing =
        environmentById.get(environment.id) ??
        environmentBySlug.get(environment.slug)

      return existing ? { ...environment, id: existing.id } : environment
    })
    const reconciledProduction =
      reconciledEnvironments.find(
        (environment) => environment.slug === 'production',
      ) ?? reconciledEnvironments[0]
    const activeEnvironmentIds = new Set(
      reconciledEnvironments.map((environment) => environment.id),
    )

    for (const [position, environment] of reconciledEnvironments.entries()) {
      const existing = environmentById.get(environment.id)
      const existingAlias = aliasRows.find(
        (alias) =>
          alias.type === 'environment' &&
          alias.environmentId === environment.id,
      )
      const effectiveServerId = environment.serverId ?? effectiveDefaultServerId
      const server = effectiveServerId
        ? context.servers.find(
            (candidate) => candidate.id === effectiveServerId,
          )
        : null

      if (effectiveServerId && !server) {
        throw new Error('Select a valid server for every environment.')
      }

      const requestedHostname = server
        ? buildDefaultHostForEnvironment({
            environmentSlug: environment.slug,
            projectName: context.project.name,
            serverPublicAddress: server.publicAddress,
          })
        : null
      const hostname = requestedHostname
        ? await resolveAvailableAliasHostname({
            excludeAliasId: existingAlias?.id,
            hostname: requestedHostname,
            uniquenessKey: environment.id,
          })
        : null

      if (existing) {
        await tx
          .update(environments)
          .set({
            name: environment.name,
            slug: environment.slug,
            branch: environment.branch,
            serverId: environment.serverId,
            color: environment.color,
            status: 'active',
            isProduction: environment.id === reconciledProduction.id,
            position,
            updatedAt: now,
          })
          .where(eq(environments.id, existing.id))
      } else {
        await tx.insert(environments).values({
          id: environment.id,
          projectId: context.project.id,
          serverId: environment.serverId,
          name: environment.name,
          slug: environment.slug,
          branch: environment.branch,
          color: environment.color,
          status: 'active',
          isProduction: environment.id === reconciledProduction.id,
          position,
          runtimeId: buildComposeProjectName({
            projectId: context.project.id,
            environmentId: environment.id,
          }),
          updatedAt: now,
        })
      }

      if (hostname && !existingAlias) {
        await tx.insert(aliases).values({
          id: crypto.randomUUID(),
          projectId: context.project.id,
          environmentId: environment.id,
          hostname,
          type: 'environment',
          https: generatedAliasUsesHttps(server?.publicAddress ?? null),
          updatedAt: now,
        })
      } else if (
        hostname &&
        existingAlias &&
        existingAlias.hostname !== hostname
      ) {
        await tx
          .update(aliases)
          .set({
            hostname,
            https: generatedAliasUsesHttps(server?.publicAddress ?? null),
            updatedAt: now,
          })
          .where(eq(aliases.id, existingAlias.id))
      } else if (!hostname && existingAlias) {
        await tx.delete(aliases).where(eq(aliases.id, existingAlias.id))
      }
    }

    const removedEnvironmentIds = environmentRows
      .filter((environment) => !activeEnvironmentIds.has(environment.id))
      .map((environment) => environment.id)

    if (removedEnvironmentIds.length > 0) {
      await tx
        .update(environments)
        .set({ status: 'deleted', isProduction: false, updatedAt: now })
        .where(inArray(environments.id, removedEnvironmentIds))
      await tx
        .delete(aliases)
        .where(inArray(aliases.environmentId, removedEnvironmentIds))
      await tx
        .delete(domains)
        .where(inArray(domains.environmentId, removedEnvironmentIds))
    }

    await tx
      .update(projects)
      .set({
        ...(defaultServerId === undefined ? {} : { defaultServerId }),
        updatedAt: now,
      })
      .where(eq(projects.id, context.project.id))
  })

  return getProjectContext({ userId, teamSlug, projectName })
}

export async function updateProjectEnvironmentServers({
  userId,
  teamSlug,
  projectName,
  defaultServerId,
  environmentServers,
}: {
  userId: string
  teamSlug: string
  projectName: string
  defaultServerId: string | null
  environmentServers: Array<{ environmentId: string; serverId: string | null }>
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const duplicateEnvironment = findDuplicate(
    environmentServers.map((assignment) => assignment.environmentId),
  )

  if (duplicateEnvironment !== null) {
    throw new Error('Each environment can only have one server assignment.')
  }

  if (
    defaultServerId &&
    !context.servers.some((server) => server.id === defaultServerId)
  ) {
    throw new Error('Select a valid default server.')
  }

  for (const assignment of environmentServers) {
    const environment = context.environments.find(
      (candidate) => candidate.id === assignment.environmentId,
    )
    const server = assignment.serverId
      ? context.servers.find(
          (candidate) => candidate.id === assignment.serverId,
        )
      : null

    if (!environment || (assignment.serverId && !server)) {
      throw new Error('Select a valid environment and server.')
    }
  }

  const serverByEnvironment = new Map(
    environmentServers.map((assignment) => [
      assignment.environmentId,
      assignment.serverId,
    ]),
  )

  return updateProjectEnvironments({
    userId,
    teamSlug,
    projectName,
    defaultServerId,
    projectEnvironments: context.environments.map((environment) => ({
      ...environment,
      serverId: serverByEnvironment.has(environment.id)
        ? (serverByEnvironment.get(environment.id) ?? null)
        : environment.serverId,
    })),
  })
}

export async function updateProjectEnvVars({
  userId,
  teamSlug,
  projectName,
  envVars,
}: {
  userId: string
  teamSlug: string
  projectName: string
  envVars: Array<ProjectEnvironmentVariable>
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const normalizedEnvVars = envVars.filter((item) => item.key.trim() !== '')
  const duplicateKey = findDuplicate(
    normalizedEnvVars.map((item) => `${item.environment ?? ''}:${item.key}`),
  )

  if (duplicateKey) {
    throw new Error('Environment variable keys must be unique per environment.')
  }

  await db
    .update(projects)
    .set({ envVars: normalizedEnvVars, updatedAt: new Date() })
    .where(eq(projects.id, context.project.id))

  return getProjectContext({ userId, teamSlug, projectName })
}

export async function updateProjectBackupConfigs({
  userId,
  teamSlug,
  projectName,
  backupConfigs: nextBackupConfigs,
}: {
  userId: string
  teamSlug: string
  projectName: string
  backupConfigs: Array<
    Omit<ProjectBackupConfig, 'destination'> & {
      destination: BackupDestinationInput
    }
  >
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const environmentIds = new Set(context.environments.map((item) => item.id))
  const existingBackupConfigRows = await db
    .select({
      id: backupConfigs.id,
      destination: backupConfigs.destination,
    })
    .from(backupConfigs)
    .where(eq(backupConfigs.projectId, context.project.id))
  const existingDestinationById = new Map(
    existingBackupConfigRows.map((item) => [
      item.id,
      typeof item.destination === 'object' && item.destination !== null
        ? (item.destination as Partial<BackupDestination>)
        : {},
    ]),
  )
  const normalizedConfigs = nextBackupConfigs
    .filter((item) => item.environmentId.trim() !== '')
    .map((item) => {
      const id = item.id.trim() || crypto.randomUUID()
      const existingDestination = existingDestinationById.get(id)
      const secretAccessKey = item.destination.secretAccessKey?.trim()
      const accessKeyId = item.destination.accessKeyId?.trim()
      const secretAccessKeyCiphertext = secretAccessKey
        ? encryptSecret(secretAccessKey)
        : item.destination.clearSecretAccessKey
          ? undefined
          : existingDestination?.secretAccessKeyCiphertext
      const secretAccessKeyPreview = secretAccessKey
        ? maskSecret(secretAccessKey)
        : item.destination.clearSecretAccessKey
          ? undefined
          : existingDestination?.secretAccessKeyPreview

      return {
        id,
        name: item.name.trim(),
        environmentId: item.environmentId,
        enabled: item.enabled,
        schedule: parseBackupSchedule(item.schedule),
        destination: {
          bucket: item.destination.bucket.trim(),
          region: item.destination.region?.trim() || undefined,
          endpoint: item.destination.endpoint?.trim() || undefined,
          prefix: item.destination.prefix?.trim() || undefined,
          accessKeyId: accessKeyId || undefined,
          secretAccessKeyCiphertext,
          secretAccessKeyPreview,
        },
        retention: item.retention,
        volumes: normalizeBackupVolumes(item.volumes),
        databaseDumps: item.databaseDumps.map((dump) => ({
          service: dump.service.trim(),
          command: dump.command.trim(),
        })),
      }
    })

  for (const backupConfig of normalizedConfigs) {
    if (!backupConfig.name) {
      throw new Error('Backup name is required.')
    }

    if (!environmentIds.has(backupConfig.environmentId)) {
      throw new Error('Select a valid backup environment.')
    }

    if (
      backupConfig.retention.remote.enabled &&
      !backupConfig.destination.bucket
    ) {
      throw new Error('Backup bucket is required.')
    }

    if (
      backupConfig.retention.remote.enabled &&
      backupConfig.destination.accessKeyId &&
      !backupConfig.destination.secretAccessKeyCiphertext
    ) {
      throw new Error('Remote backup secret access key is required.')
    }

    if (
      backupConfig.retention.remote.enabled &&
      !backupConfig.destination.accessKeyId &&
      backupConfig.destination.secretAccessKeyCiphertext
    ) {
      throw new Error('Remote backup access key ID is required.')
    }
  }

  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .delete(backupConfigs)
      .where(eq(backupConfigs.projectId, context.project.id))

    if (normalizedConfigs.length > 0) {
      const values: Array<typeof backupConfigs.$inferInsert> =
        normalizedConfigs.map((backupConfig) => ({
          id: backupConfig.id,
          name: backupConfig.name,
          projectId: context.project.id,
          environmentId: backupConfig.environmentId,
          enabled: backupConfig.enabled,
          destinationType: 's3',
          schedule: backupConfig.schedule,
          destination: backupConfig.destination,
          retention: backupConfig.retention,
          volumes: backupConfig.volumes,
          databaseDumps: backupConfig.databaseDumps,
          createdAt: now,
          updatedAt: now,
        }))

      await tx.insert(backupConfigs).values(values)
    }
  })

  return getProjectContext({ userId, teamSlug, projectName })
}

export async function createManualBackupRun({
  backupConfigId,
  userId,
  teamSlug,
  projectName,
}: {
  backupConfigId: string
  userId: string
  teamSlug: string
  projectName: string
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const backupConfig = context.backupConfigs.find(
    (candidate) => candidate.id === backupConfigId,
  )

  if (!backupConfig) {
    throw new Error('Backup policy not found.')
  }

  await queueEnvironmentBackup({
    projectId: context.project.id,
    environmentId: backupConfig.environmentId,
    manifest: {
      trigger: 'manual',
      backupConfigId,
      requestedAt: new Date().toISOString(),
    },
  })

  return getProjectContext({ userId, teamSlug, projectName })
}

export async function createBackupRestoreJob({
  userId,
  teamSlug,
  projectName,
  backupRunId,
  artifacts,
}: {
  userId: string
  teamSlug: string
  projectName: string
  backupRunId: string
  artifacts: Array<
    | {
        artifactId: string
        type: 'volume'
        targetVolume: string
      }
    | {
        artifactId: string
        type: 'database'
        targetService: string
        restoreCommand: string
      }
  >
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })

  await queueBackupRestoreJob({
    projectId: context.project.id,
    backupRunId,
    artifacts,
  })

  return getProjectContext({ userId, teamSlug, projectName })
}

export async function createManualDeployment({
  environmentId,
  gitBranch,
  gitSha,
  userId,
  teamSlug,
  projectName,
}: {
  environmentId: string
  gitBranch: string
  gitSha?: string | null
  userId: string
  teamSlug: string
  projectName: string
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const environmentConfig = context.environments.find(
    (environment) => environment.id === environmentId,
  )

  if (!environmentConfig) {
    throw new Error('Deployment environment not found.')
  }

  const matchedEnvironment = getEnvironmentForBranch(
    gitBranch,
    context.environments,
  )

  if (matchedEnvironment?.id !== environmentConfig.id) {
    throw new Error('The selected branch does not match this environment.')
  }

  const environmentRows = await db
    .select({ environment: environments, project: projects, server: servers })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .leftJoin(
      servers,
      eq(
        servers.id,
        sql`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
      ),
    )
    .where(
      and(
        eq(environments.id, environmentConfig.id),
        eq(environments.projectId, context.project.id),
      ),
    )
    .limit(1)
  const environmentRow = environmentRows.at(0)

  if (!environmentRow?.server) {
    throw new Error('Assign a server before deploying.')
  }

  if (
    getEffectiveServerStatus({
      status: environmentRow.server.status,
      lastSeenAt: environmentRow.server.lastSeenAt,
    }) !== 'connected'
  ) {
    throw new Error(
      'Wait until the assigned server is connected before deploying.',
    )
  }

  const [aliasRows, domainRows] = await Promise.all([
    db
      .select()
      .from(aliases)
      .where(
        and(
          eq(aliases.projectId, context.project.id),
          eq(aliases.environmentId, environmentConfig.id),
        ),
      ),
    db
      .select()
      .from(domains)
      .where(
        and(
          eq(domains.projectId, context.project.id),
          eq(domains.environmentId, environmentConfig.id),
        ),
      ),
  ])

  if (
    resolveDeploymentPublicRoutes({
      environment: environmentRow.environment,
      aliasRows,
      domainRows,
      project: environmentRow.project,
      gitBranch,
    }).routes.length === 0
  ) {
    throw new Error('Configure a public route before deploying.')
  }

  if (!context.project.githubInstallationId || !context.project.githubRepoId) {
    throw new Error('Connect a GitHub App installation before deploying.')
  }

  const installationToken = await createInstallationAccessToken({
    installationId: context.project.githubInstallationId,
    repositoryId: context.project.githubRepoId,
  })
  const commit = gitSha
    ? (
        await listBranchCommits({
          accessToken: installationToken.token,
          branch: gitBranch,
          repo: context.project.githubRepo,
          perPage: 5,
        })
      ).find((candidate) => candidate.sha === gitSha)
    : await getBranchHeadCommit({
        accessToken: installationToken.token,
        branch: gitBranch,
        repo: context.project.githubRepo,
      })

  if (!commit) {
    throw new Error('The selected commit is not available on this branch.')
  }

  const logMessage = `Queued ${context.project.githubRepo} for ${environmentConfig.name}.`

  const deployment = await createDeploymentForEnvironment({
    environmentId: environmentConfig.id,
    gitBranch,
    gitSha: commit.sha,
    trigger: 'user',
    commitMeta: toDeploymentCommitMeta(commit),
    queuedMessage: logMessage,
    createdByUserId: userId,
  })

  return {
    deploymentId: deployment.deploymentId,
  }
}

export async function createRollbackDeployment({
  deploymentId,
  userId,
  teamSlug,
  projectName,
}: {
  deploymentId: string
  userId: string
  teamSlug: string
  projectName: string
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const rows = await db
    .select({
      deployment: deployments,
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(environments.projectId, context.project.id),
      ),
    )
    .limit(1)
  const row = rows.at(0)
  const source = row?.deployment

  if (!source) {
    throw new Error('Deployment not found.')
  }

  if (source.status !== 'succeeded') {
    throw new Error('Only successful deployments can be rolled back to.')
  }

  const deploymentConfig = parseDeploymentConfig(source.config)

  if (!deploymentConfig) {
    throw new Error('Deployment config is invalid.')
  }

  const serverRows = await db
    .select()
    .from(servers)
    .where(eq(servers.id, source.serverId))
    .limit(1)
  const deploymentServer = serverRows.at(0)

  if (!deploymentServer) {
    throw new Error('Deployment server not found.')
  }

  const serverStatus = getEffectiveServerStatus({
    status: deploymentServer.status,
    lastSeenAt: deploymentServer.lastSeenAt,
  })

  if (serverStatus !== 'connected') {
    throw new Error('Reconnect the deployment server before rolling back.')
  }

  const rollbackDeploymentId = crypto.randomUUID()
  const rollbackAliasHostname = buildDeploymentAliasHostname({
    deploymentId: rollbackDeploymentId,
    projectName: context.project.name,
    serverPublicAddress: deploymentServer.publicAddress,
  })
  const sourceAliasRows = await db
    .select({ hostname: aliases.hostname })
    .from(aliases)
    .where(
      and(eq(aliases.deploymentId, source.id), eq(aliases.type, 'deployment')),
    )
  const rollbackConfig = replaceDeploymentAliasRoutes({
    config: deploymentConfig,
    hostname: rollbackAliasHostname,
    https: generatedAliasUsesHttps(deploymentServer.publicAddress),
    previousHostnames: sourceAliasRows.map((alias) => alias.hostname),
  })
  const now = new Date()
  const commitMeta = normalizeDeploymentCommitMeta(source.commitMeta)
  const environmentName =
    context.environments.find((item) => item.id === source.environmentId)
      ?.name ?? 'environment'

  await db.transaction(async (tx) => {
    await cancelActiveDeploymentsForEnvironment(tx, {
      environmentId: source.environmentId,
      message: 'Canceled because a rollback deployment was queued.',
      now,
    })

    await tx.insert(deployments).values({
      id: rollbackDeploymentId,
      environmentId: source.environmentId,
      serverId: deploymentServer.id,
      status: 'queued',
      phase: 'queued',
      trigger: 'rollback',
      repoId: source.repoId,
      repoFullName: source.repoFullName,
      gitSha: source.gitSha,
      gitBranch: source.gitBranch,
      commitMeta,
      config: rollbackConfig,
      envVars: source.envVars,
      runtimeId: source.runtimeId,
      createdByUserId: userId,
    })

    await tx.insert(deploymentLogs).values({
      deploymentId: rollbackDeploymentId,
      stream: 'deploy',
      seq: 1,
      content: `Queued rollback to ${source.gitSha.slice(0, 7)} for ${environmentName}.`,
      createdAt: now,
    })

    await tx.insert(aliases).values({
      id: crypto.randomUUID(),
      projectId: context.project.id,
      deploymentId: rollbackDeploymentId,
      hostname: rollbackAliasHostname,
      type: 'deployment',
      environmentId: source.environmentId,
      https: generatedAliasUsesHttps(deploymentServer.publicAddress),
      updatedAt: now,
    })
  })

  return {
    deploymentId: rollbackDeploymentId,
  }
}

export async function createRedeployDeployment({
  deploymentId,
  userId,
  teamSlug,
  projectName,
}: {
  deploymentId: string
  userId: string
  teamSlug: string
  projectName: string
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const rows = await db
    .select({ deployment: deployments })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(environments.projectId, context.project.id),
      ),
    )
    .limit(1)
  const source = rows.at(0)?.deployment

  if (!source) {
    throw new Error('Deployment not found.')
  }

  if (source.status === 'queued' || source.status === 'running') {
    throw new Error('Queued or running deployments cannot be redeployed.')
  }

  const deploymentConfig = parseDeploymentConfig(source.config)

  if (!deploymentConfig) {
    throw new Error('Deployment config is invalid.')
  }

  const serverRows = await db
    .select()
    .from(servers)
    .where(eq(servers.id, source.serverId))
    .limit(1)
  const deploymentServer = serverRows.at(0)

  if (!deploymentServer) {
    throw new Error('Deployment server not found.')
  }

  const serverStatus = getEffectiveServerStatus({
    status: deploymentServer.status,
    lastSeenAt: deploymentServer.lastSeenAt,
  })

  if (serverStatus !== 'connected') {
    throw new Error('Reconnect the deployment server before redeploying.')
  }

  const redeploymentId = crypto.randomUUID()
  const redeploymentAliasHostname = buildDeploymentAliasHostname({
    deploymentId: redeploymentId,
    projectName: context.project.name,
    serverPublicAddress: deploymentServer.publicAddress,
  })
  const sourceAliasRows = await db
    .select({ hostname: aliases.hostname })
    .from(aliases)
    .where(
      and(eq(aliases.deploymentId, source.id), eq(aliases.type, 'deployment')),
    )
  const redeploymentConfig = replaceDeploymentAliasRoutes({
    config: deploymentConfig,
    hostname: redeploymentAliasHostname,
    https: generatedAliasUsesHttps(deploymentServer.publicAddress),
    previousHostnames: sourceAliasRows.map((alias) => alias.hostname),
  })
  const now = new Date()
  const commitMeta = normalizeDeploymentCommitMeta(source.commitMeta)
  const environmentName =
    context.environments.find((item) => item.id === source.environmentId)
      ?.name ?? 'environment'

  await db.transaction(async (tx) => {
    await cancelActiveDeploymentsForEnvironment(tx, {
      environmentId: source.environmentId,
      message: 'Canceled because a redeployment was queued.',
      now,
    })

    await tx.insert(deployments).values({
      id: redeploymentId,
      environmentId: source.environmentId,
      serverId: deploymentServer.id,
      status: 'queued',
      phase: 'queued',
      trigger: 'user',
      repoId: source.repoId,
      repoFullName: source.repoFullName,
      gitSha: source.gitSha,
      gitBranch: source.gitBranch,
      commitMeta,
      config: redeploymentConfig,
      envVars: source.envVars,
      runtimeId: source.runtimeId,
      createdByUserId: userId,
    })

    await tx.insert(deploymentLogs).values({
      deploymentId: redeploymentId,
      stream: 'deploy',
      seq: 1,
      content: `Queued redeploy of ${source.gitSha.slice(0, 7)} for ${environmentName}.`,
      createdAt: now,
    })

    await tx.insert(aliases).values({
      id: crypto.randomUUID(),
      projectId: context.project.id,
      deploymentId: redeploymentId,
      hostname: redeploymentAliasHostname,
      type: 'deployment',
      environmentId: source.environmentId,
      https: generatedAliasUsesHttps(deploymentServer.publicAddress),
      updatedAt: now,
    })
  })

  return {
    deploymentId: redeploymentId,
  }
}

export async function getManualDeploymentOptions({
  environmentId,
  userId,
  teamSlug,
  projectName,
}: {
  environmentId: string
  userId: string
  teamSlug: string
  projectName: string
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const environment = context.environments.find(
    (candidate) => candidate.id === environmentId,
  )

  if (!environment) {
    throw new Error('Deployment environment not found.')
  }

  if (!context.project.githubInstallationId || !context.project.githubRepoId) {
    throw new Error('Connect a GitHub App installation before deploying.')
  }

  const installationToken = await createInstallationAccessToken({
    installationId: context.project.githubInstallationId,
    repositoryId: context.project.githubRepoId,
  })
  const branches = await listRepositoryBranches({
    accessToken: installationToken.token,
    repo: context.project.githubRepo,
  })
  const matchingBranches =
    groupBranchesByEnvironment(context.environments, branches).get(
      environment.id,
    ) ?? []
  const commits = (
    await Promise.all(
      matchingBranches.map(async (branch) =>
        (
          await listBranchCommits({
            accessToken: installationToken.token,
            branch,
            repo: context.project.githubRepo,
            perPage: 5,
          })
        ).map((commit) => ({ ...commit, branch })),
      ),
    )
  )
    .flat()
    .sort(
      (left, right) =>
        Date.parse(right.authoredAt ?? '') - Date.parse(left.authoredAt ?? ''),
    )

  return {
    environment: {
      id: environment.id,
      name: environment.name,
      branch: environment.branch,
      color: environment.color,
    },
    commits,
  }
}

export async function createDeploymentsForGitHubPush({
  installationId,
  repositoryId,
  repositoryFullName,
  branch,
  gitSha,
  message,
}: {
  installationId: number
  repositoryId: number
  repositoryFullName: string
  branch: string
  gitSha: string
  message: string | null
}) {
  const candidateRows = await db
    .select({
      project: projects,
      environment: environments,
      server: servers,
    })
    .from(projects)
    .innerJoin(environments, eq(environments.projectId, projects.id))
    .leftJoin(
      servers,
      eq(
        servers.id,
        sql`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
      ),
    )
    .where(
      and(
        eq(projects.githubInstallationId, installationId),
        eq(projects.githubRepoId, repositoryId),
        eq(projects.githubRepo, repositoryFullName),
        eq(projects.status, 'active'),
        eq(environments.status, 'active'),
      ),
    )
    .orderBy(asc(projects.id), asc(environments.position))
  const candidatesByProject = new Map<
    string,
    Array<(typeof candidateRows)[number]>
  >()

  for (const row of candidateRows) {
    const candidates = candidatesByProject.get(row.project.id) ?? []
    candidates.push(row)
    candidatesByProject.set(row.project.id, candidates)
  }

  const rows = Array.from(candidatesByProject.values()).flatMap(
    (candidates) => {
      const environmentConfig = getEnvironmentForBranch(
        branch,
        candidates.map((candidate) =>
          mapEnvironmentConfig(
            candidate.environment,
            candidate.project.defaultServerId,
          ),
        ),
      )

      if (!environmentConfig) {
        return []
      }

      const matched = candidates.find(
        (candidate) =>
          candidate.environment.id === environmentConfig.id ||
          candidate.environment.slug === environmentConfig.slug,
      )

      return matched ? [matched] : []
    },
  )

  const created: Array<{
    deploymentId: string
    projectId: string
    environmentId: string
  }> = []
  const skipped: Array<{
    projectId: string
    environmentId: string
    reason: string
  }> = []

  for (const row of rows) {
    const [aliasRows, domainRows] = await Promise.all([
      db
        .select()
        .from(aliases)
        .where(
          and(
            eq(aliases.projectId, row.project.id),
            eq(aliases.environmentId, row.environment.id),
            eq(aliases.type, 'environment'),
          ),
        ),
      db
        .select()
        .from(domains)
        .where(
          and(
            eq(domains.projectId, row.project.id),
            eq(domains.environmentId, row.environment.id),
          ),
        ),
    ])
    const routeCount = resolveDeploymentPublicRoutes({
      environment: row.environment,
      aliasRows,
      domainRows,
      gitBranch: branch,
      project: row.project,
    }).routes.length
    const serverStatus = row.server
      ? getEffectiveServerStatus({
          status: row.server.status,
          lastSeenAt: row.server.lastSeenAt,
        })
      : null

    if (!row.server || serverStatus !== 'connected') {
      skipped.push({
        projectId: row.project.id,
        environmentId: row.environment.id,
        reason: 'server_disconnected',
      })
      continue
    }

    if (routeCount === 0) {
      skipped.push({
        projectId: row.project.id,
        environmentId: row.environment.id,
        reason: 'missing_route',
      })
      continue
    }

    const deployment = await createDeploymentForEnvironment({
      environmentId: row.environment.id,
      gitBranch: branch,
      gitSha,
      trigger: 'webhook',
      commitMeta: {
        message,
        authorName: null,
        authoredAt: null,
        url: null,
      },
      queuedMessage: `Queued ${row.project.githubRepo} from GitHub push to ${branch}.`,
    })

    created.push({
      deploymentId: deployment.deploymentId,
      projectId: row.project.id,
      environmentId: row.environment.id,
    })
  }

  return {
    matched: rows.length,
    created,
    skipped,
  }
}

function mapProject(
  project: typeof projects.$inferSelect,
): ProjectContext['project'] {
  return {
    id: project.id,
    name: project.name,
    githubInstallationId: project.githubInstallationId,
    githubRepoId: project.githubRepoId,
    githubRepo: project.githubRepo,
    defaultServerId: project.defaultServerId,
    avatarUrl: project.avatarPath,
    composePath: project.composePath,
    releaseCommand: project.releaseCommand,
    releaseService: project.releaseService,
    readinessPath: project.readinessPath,
    color: getResourceColor(project.id),
  }
}

async function getProjectComposeMetadata({
  project,
  ref,
}: {
  project: typeof projects.$inferSelect
  ref: string
}): Promise<ProjectComposeMetadata | null> {
  if (
    !project.composePath ||
    !project.githubInstallationId ||
    !project.githubRepo
  ) {
    return null
  }

  try {
    const installation = await createInstallationAccessToken({
      installationId: project.githubInstallationId,
      repositoryId: project.githubRepoId,
    })
    const composeText = await getRepositoryFileText({
      accessToken: installation.token,
      repo: project.githubRepo,
      path: project.composePath,
      ref,
    })

    return parseComposeMetadata(composeText)
  } catch {
    return null
  }
}

function parseComposeMetadata(composeText: string): ProjectComposeMetadata {
  const document = parseYaml(composeText)
  const root = isRecord(document) ? document : {}
  const services = isRecord(root.services)
    ? Object.keys(root.services).filter(Boolean).sort()
    : []
  const volumes = new Set<string>()

  if (isRecord(root.volumes)) {
    for (const volumeName of Object.keys(root.volumes)) {
      if (volumeName) {
        volumes.add(volumeName)
      }
    }
  }

  if (isRecord(root.services)) {
    for (const service of Object.values(root.services)) {
      if (!isRecord(service) || !Array.isArray(service.volumes)) {
        continue
      }

      for (const mount of service.volumes) {
        const volumeName = getComposeVolumeName(mount)

        if (volumeName) {
          volumes.add(volumeName)
        }
      }
    }
  }

  return {
    services,
    volumes: Array.from(volumes).sort(),
  }
}

function getComposeVolumeName(mount: unknown) {
  if (typeof mount === 'string') {
    const [source] = mount.split(':')
    const trimmed = source.trim()

    return isNamedComposeVolume(trimmed) ? trimmed : null
  }

  if (!isRecord(mount)) {
    return null
  }

  const type = typeof mount.type === 'string' ? mount.type : null
  const source = typeof mount.source === 'string' ? mount.source.trim() : ''

  if (type && type !== 'volume') {
    return null
  }

  return isNamedComposeVolume(source) ? source : null
}

function isNamedComposeVolume(value: string | null | undefined) {
  return Boolean(
    value &&
    !value.startsWith('/') &&
    !value.startsWith('./') &&
    !value.startsWith('../') &&
    !value.startsWith('~/') &&
    !value.includes('$'),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapEnvironment(
  environment: typeof environments.$inferSelect,
  server: typeof servers.$inferSelect | null,
): ProjectContext['environment'] {
  return {
    id: environment.id,
    name: environment.name,
    slug: environment.slug,
    branch: environment.branch,
    color: environment.color,
    position: environment.position,
    defaultHost: null,
    serverId: server?.id ?? null,
    serverName: server?.name ?? null,
    serverStatus: server
      ? getEffectiveServerStatus({
          status: server.status,
          lastSeenAt: server.lastSeenAt,
        })
      : null,
    envVars: [],
    publicRoutes: [],
    runtime: null,
  }
}

function mapRuntimeObservation(
  observation: {
    lastSeenAt: Date
    services: unknown
  } | null,
): ProjectContext['environment']['runtime'] {
  if (!observation || !Array.isArray(observation.services)) {
    return null
  }

  const services = observation.services.flatMap((value) => {
    if (!isRecord(value)) {
      return []
    }
    const name = typeof value.name === 'string' ? value.name : null
    const containerName =
      typeof value.containerName === 'string' ? value.containerName : null
    const state = typeof value.state === 'string' ? value.state : null
    if (!name || !containerName || !state) {
      return []
    }
    return [
      {
        name,
        containerName,
        state,
        health: typeof value.health === 'string' ? value.health : null,
        restartCount:
          typeof value.restartCount === 'number' ? value.restartCount : 0,
        startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
        exitCode: typeof value.exitCode === 'number' ? value.exitCode : 0,
      },
    ]
  })

  return {
    observedAt: observation.lastSeenAt.toISOString(),
    services,
  }
}

function mapDeployment({
  deployment,
  environment,
  project,
  server,
}: {
  deployment: typeof deployments.$inferSelect
  environment: typeof environments.$inferSelect
  project: typeof projects.$inferSelect
  server?: typeof servers.$inferSelect | null
}): DeploymentSummary {
  const deploymentConfig = parseDeploymentConfig(deployment.config)
  const routes = normalizeRoutes(deploymentConfig?.routes ?? [], null)
  const commitMeta = normalizeDeploymentCommitMeta(deployment.commitMeta)

  return {
    id: deployment.id,
    status: deployment.status,
    phase: deployment.phase,
    trigger: deployment.trigger,
    gitSha: deployment.gitSha,
    gitBranch: deployment.gitBranch,
    githubRepo: deployment.repoFullName,
    defaultHost: routes.at(0)?.host ?? null,
    defaultRouteHttps: routes.at(0)?.https ?? true,
    commitMessage: commitMeta.message,
    errorMessage: deployment.errorMessage,
    createdAt: deployment.createdAt.toISOString(),
    startedAt: deployment.startedAt?.toISOString() ?? null,
    finishedAt: deployment.finishedAt?.toISOString() ?? null,
    environmentName: environment.name,
    environmentSlug: environment.slug,
    environmentColor: environment.color,
    serverId: server?.id ?? deployment.serverId,
    serverName: server?.name ?? 'Unknown server',
    serverStatus: server
      ? getEffectiveServerStatus({
          status: server.status,
          lastSeenAt: server.lastSeenAt,
        })
      : 'disconnected',
    projectName: project.name,
    projectColor: getResourceColor(project.id),
  }
}

function normalizeEnvVars(value: unknown): Array<ProjectEnvironmentVariable> {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (item): item is ProjectEnvironmentVariable =>
        typeof item === 'object' &&
        item !== null &&
        'key' in item &&
        'value' in item &&
        typeof item.key === 'string' &&
        typeof item.value === 'string',
    )
    .map((item) => ({
      key: item.key,
      value: item.value,
      environment:
        'environment' in item && typeof item.environment === 'string'
          ? item.environment
          : '',
    }))
    .filter((item) => item.key.trim() !== '')
}

function mapEnvironmentConfig(
  environment: typeof environments.$inferSelect,
  defaultServerId: string | null,
): ProjectEnvironmentConfig {
  return {
    id: environment.id,
    name: environment.name,
    slug: environment.slug,
    branch: environment.branch,
    color: environment.color,
    position: environment.position,
    status: environment.status,
    effectiveServerId: environment.serverId ?? defaultServerId,
    serverId: environment.serverId,
  }
}

function getProductionEnvironment(
  environmentsConfig: Array<ProjectEnvironmentConfig>,
) {
  return (
    environmentsConfig.find(
      (environment) => environment.slug === 'production',
    ) ?? environmentsConfig[0]
  )
}

function normalizeProjectRoutes(value: unknown): Array<ProjectRoute> {
  if (!Array.isArray(value)) {
    return [{ path: '/', service: 'web', port: 3000, stripPrefix: false }]
  }

  const routes = value
    .filter(
      (item): item is ProjectRoute =>
        typeof item === 'object' &&
        item !== null &&
        'service' in item &&
        'port' in item &&
        'path' in item &&
        typeof item.service === 'string' &&
        typeof item.port === 'number' &&
        typeof item.path === 'string',
    )
    .map((route) => ({
      ...route,
      stripPrefix:
        'stripPrefix' in route && typeof route.stripPrefix === 'boolean'
          ? route.stripPrefix
          : false,
    }))
    .filter((route) => route.service && route.path.startsWith('/'))

  return routes.length > 0
    ? routes
    : [{ path: '/', service: 'web', port: 3000, stripPrefix: false }]
}

type RouteHostname = {
  hostname: string
  environmentId: string
  basePath: string | null
  https: boolean
}

function expandPublicRoutesFromHostnames(
  routes: Array<ProjectRoute>,
  hostnameRows: Array<RouteHostname>,
): Array<ProjectPublicRoute> {
  return hostnameRows.flatMap((hostname) => {
    const targetRoutes = hostname.basePath
      ? routes.filter((route) => route.path === hostname.basePath)
      : routes

    return targetRoutes.map((route) => ({
      host: hostname.hostname,
      https: hostname.https,
      path: route.path,
      port: route.port,
      service: route.service,
      stripPrefix: route.stripPrefix,
    }))
  })
}

function toRouteHostnames(
  aliasRows: Array<typeof aliases.$inferSelect>,
  domainRows: Array<typeof domains.$inferSelect>,
): Array<RouteHostname> {
  return [
    ...aliasRows.map((alias) => ({
      hostname: alias.hostname,
      environmentId: alias.environmentId,
      basePath: null,
      https: alias.https,
    })),
    ...domainRows.map((domain) => ({
      hostname: domain.hostname,
      environmentId: domain.environmentId,
      basePath: domain.basePath,
      https: domain.https,
    })),
  ]
}

function mapProjectDomains(
  domainRows: Array<typeof domains.$inferSelect>,
): Array<ProjectDomain> {
  return domainRows.map((domain) => ({
    id: domain.id,
    host: domain.hostname,
    environmentId: domain.environmentId,
    basePath: domain.basePath,
    https: domain.https,
    status: domain.status,
  }))
}

function mapBackupConfig(
  backupConfig: typeof backupConfigs.$inferSelect,
): ProjectBackupConfig {
  const destination =
    typeof backupConfig.destination === 'object' &&
    backupConfig.destination !== null
      ? (backupConfig.destination as Partial<BackupDestination>)
      : {}
  const retention = backupRetentionSchema.parse(backupConfig.retention)
  const databaseDumps = Array.isArray(backupConfig.databaseDumps)
    ? backupConfig.databaseDumps.filter(
        (dump): dump is BackupDatabaseDump =>
          typeof dump === 'object' &&
          dump !== null &&
          'service' in dump &&
          'command' in dump &&
          typeof dump.service === 'string' &&
          typeof dump.command === 'string',
      )
    : []

  return {
    id: backupConfig.id,
    name: backupConfig.name,
    environmentId: backupConfig.environmentId,
    enabled: backupConfig.enabled,
    schedule: parseBackupSchedule(backupConfig.schedule),
    destination: {
      bucket: destination.bucket ?? '',
      region: destination.region,
      endpoint: destination.endpoint,
      prefix: destination.prefix,
      accessKeyId: destination.accessKeyId,
      secretAccessKeyPreview: destination.secretAccessKeyPreview
        ? 'Configured'
        : undefined,
    },
    retention,
    volumes: normalizeBackupVolumes(backupConfig.volumes),
    databaseDumps,
  }
}

function maskSecret(value: string) {
  return value.length > 0 ? 'Configured' : ''
}

function mapBackupRun(
  {
    backupRun,
    environment,
    server,
  }: {
    backupRun: typeof backupRuns.$inferSelect
    environment: typeof environments.$inferSelect
    server: typeof servers.$inferSelect | null
  },
  projectEnvironments: Array<ProjectEnvironmentConfig>,
  artifacts: Array<typeof backupArtifacts.$inferSelect>,
): ProjectBackupRun {
  const environmentConfig =
    projectEnvironments.find((item) => item.id === environment.id) ?? null

  return {
    id: backupRun.id,
    status: backupRun.status,
    environmentId: environment.id,
    environmentName: environmentConfig?.name ?? environment.name,
    environmentColor:
      environmentConfig?.color ?? getResourceColor(environment.name),
    serverId: server?.id ?? null,
    serverName: server?.name ?? null,
    errorMessage: backupRun.errorMessage,
    startedAt: backupRun.startedAt?.toISOString() ?? null,
    finishedAt: backupRun.finishedAt?.toISOString() ?? null,
    createdAt: backupRun.createdAt.toISOString(),
    artifacts: artifacts.map(mapBackupArtifact),
  }
}

function mapBackupArtifact(
  artifact: typeof backupArtifacts.$inferSelect,
): ProjectBackupArtifact {
  return {
    id: artifact.id,
    type: artifact.type,
    storage: artifact.storage,
    objectKey: artifact.objectKey,
    checksumSha256: artifact.checksumSha256,
    sizeBytes: artifact.sizeBytes,
    createdAt: artifact.createdAt.toISOString(),
  }
}

function parseBackupSchedule(value: unknown): ProjectBackupSchedule {
  if (typeof value === 'object' && value !== null) {
    const schedule = value as Partial<ProjectBackupSchedule>

    if (typeof schedule.cron === 'string' && isCronSchedule(schedule.cron)) {
      return { cron: schedule.cron.trim() }
    }
  }

  throw new Error('Backup schedules must use a five-field cron expression.')
}

function normalizeBackupVolumes(value: unknown): BackupVolumeSelection {
  if (typeof value === 'object' && value !== null) {
    const volumes = value as Partial<BackupVolumeSelection>

    if (volumes.mode === 'none') {
      return { mode: 'none', names: [] }
    }

    if (volumes.mode === 'selected' && Array.isArray(volumes.names)) {
      const names = volumes.names
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)

      return names.length > 0
        ? { mode: 'selected', names }
        : { mode: 'allNamed', names: [] }
    }
  }

  return { mode: 'allNamed', names: [] }
}

function isCronSchedule(value: string) {
  return /^(\S+\s+){4}\S+$/.test(value.trim())
}

function getEnvVarsForEnvironment(
  envVars: Array<ProjectEnvironmentVariable>,
  environment: string,
) {
  const values = new Map<string, ProjectEnvironmentVariable>()

  for (const envVar of envVars) {
    if (!envVar.environment) {
      values.set(envVar.key, envVar)
    }
  }

  for (const envVar of envVars) {
    if (envVar.environment === environment) {
      values.set(envVar.key, envVar)
    }
  }

  return Array.from(values.values())
}

function findDuplicate(values: Array<string>) {
  const seen = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      return value
    }

    seen.add(value)
  }

  return null
}

function normalizeRoutes(
  value: unknown,
  defaultHost: string | null,
): Array<ProjectPublicRoute> {
  if (!Array.isArray(value)) {
    return defaultHost
      ? [
          {
            host: defaultHost,
            service: 'web',
            port: 3000,
            path: '/',
            https: true,
            stripPrefix: false,
          },
        ]
      : []
  }

  return value
    .filter(
      (item): item is ProjectPublicRoute =>
        typeof item === 'object' &&
        item !== null &&
        'host' in item &&
        'service' in item &&
        'port' in item &&
        'path' in item &&
        'https' in item &&
        typeof item.host === 'string' &&
        typeof item.service === 'string' &&
        typeof item.port === 'number' &&
        typeof item.path === 'string' &&
        typeof item.https === 'boolean',
    )
    .map((route) => ({
      ...route,
      stripPrefix:
        'stripPrefix' in route && typeof route.stripPrefix === 'boolean'
          ? route.stripPrefix
          : false,
    }))
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '')

  return slug || 'project'
}

function validateProjectMachineName(name: string) {
  if (
    name.length === 0 ||
    name.length > 100 ||
    !projectMachineNamePattern.test(name)
  ) {
    throw new Error(projectMachineNameError)
  }
}

export function buildDefaultHostForProject({
  projectName,
  serverPublicAddress,
}: {
  projectName: string
  serverPublicAddress: string | null
}) {
  const address = resolveRoutingIpv4(serverPublicAddress)
  const addressLabel = address.replaceAll('.', '-')
  const prefix = toNipPrefix(projectName, 63 - addressLabel.length - 1)

  return `${prefix}-${addressLabel}.nip.io`
}

function toNipPrefix(value: string, maxLength: number) {
  const normalized =
    value
      .toLowerCase()
      .replace(/[\s_.]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'app'

  if (normalized.length <= maxLength) {
    return normalized
  }

  const hash = stableHostHash(normalized)
  const remainingLength = maxLength - hash.length - 2
  const startLength = Math.ceil(remainingLength / 2)
  const endLength = Math.floor(remainingLength / 2)

  return `${normalized.slice(0, startLength)}-${hash}-${normalized.slice(-endLength)}`
}

function stableHostHash(value: string) {
  let hash = 2_166_136_261

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }

  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 7)
}

function buildDefaultHostForEnvironment({
  environmentSlug,
  projectName,
  serverPublicAddress,
}: {
  environmentSlug: string
  projectName: string
  serverPublicAddress: string | null
}) {
  const hostSlug =
    environmentSlug === 'production'
      ? projectName
      : `${projectName}-env-${slugify(environmentSlug)}`

  return buildDefaultHostForProject({
    projectName: hostSlug,
    serverPublicAddress,
  })
}

function buildDeploymentAliasHostname({
  deploymentId,
  projectName,
  serverPublicAddress,
}: {
  deploymentId: string
  projectName: string
  serverPublicAddress: string | null
}) {
  return buildDefaultHostForProject({
    projectName: `${deploymentId.slice(0, 7)}-${projectName}`,
    serverPublicAddress,
  })
}

function buildBranchAliasHostname({
  branch,
  projectName,
  serverPublicAddress,
}: {
  branch: string
  projectName: string
  serverPublicAddress: string | null
}) {
  return buildDefaultHostForProject({
    projectName: `${projectName}-git-${slugify(branch)}`,
    serverPublicAddress,
  })
}

function disambiguateNipHostname(hostname: string, uniquenessKey: string) {
  const match = /^(.*)-(\d{1,3}(?:-\d{1,3}){3})\.nip\.io$/.exec(hostname)

  if (!match) {
    throw new Error(`Generated alias "${hostname}" is not a nip.io hostname.`)
  }

  const [, prefix = 'app', address = '127-0-0-1'] = match
  const maxPrefixLength = 63 - address.length - 1
  const resolvedPrefix = toNipPrefix(
    `${prefix}-${stableHostHash(uniquenessKey)}`,
    maxPrefixLength,
  )

  return `${resolvedPrefix}-${address}.nip.io`
}

async function resolveAvailableAliasHostname({
  excludeAliasId,
  hostname,
  uniquenessKey,
}: {
  excludeAliasId?: string
  hostname: string
  uniquenessKey: string
}) {
  let candidate = hostname

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [aliasRows, domainRows] = await Promise.all([
      db
        .select({ id: aliases.id })
        .from(aliases)
        .where(
          and(
            eq(aliases.hostname, candidate),
            excludeAliasId ? ne(aliases.id, excludeAliasId) : undefined,
          ),
        )
        .limit(1),
      db
        .select({ id: domains.id })
        .from(domains)
        .where(eq(domains.hostname, candidate))
        .limit(1),
    ])

    if (aliasRows.length === 0 && domainRows.length === 0) {
      return candidate
    }

    candidate = disambiguateNipHostname(hostname, `${uniquenessKey}:${attempt}`)
  }

  throw new Error('Could not generate an available nip.io hostname.')
}

function replaceDeploymentAliasRoutes({
  config: deploymentConfig,
  hostname,
  https,
  previousHostnames,
}: {
  config: DeploymentConfig
  hostname: string
  https: boolean
  previousHostnames: Array<string>
}): DeploymentConfig {
  const previous = new Set(previousHostnames)
  const stableRoutes = deploymentConfig.routes.filter(
    (route) => !previous.has(route.host),
  )
  const routeShapes = new Map<
    string,
    Omit<DeploymentConfig['routes'][number], 'host' | 'https'>
  >()

  for (const route of stableRoutes.length > 0
    ? stableRoutes
    : deploymentConfig.routes) {
    const { host: _host, https: _https, ...shape } = route
    const key = `${shape.service}:${shape.port}:${shape.path}:${shape.stripPrefix}`
    routeShapes.set(key, shape)
  }

  return {
    ...deploymentConfig,
    routes: [
      ...stableRoutes,
      ...Array.from(routeShapes.values(), (route) => ({
        ...route,
        host: hostname,
        https,
      })),
    ],
  }
}

function resolveRoutingIpv4(value: string | null) {
  if (value && isIpv4Address(value)) {
    return value
  }

  const controlPlaneHost = new URL(config.BETTER_AUTH_URL).hostname

  if (controlPlaneHost === 'localhost' || controlPlaneHost === '127.0.0.1') {
    return '127.0.0.1'
  }

  throw new Error(
    'The assigned server has no IPv4 address for generating its nip.io URL.',
  )
}

function isIpv4Address(value: string) {
  const octets = value.split('.').map((part) => Number.parseInt(part, 10))

  return (
    octets.length === 4 &&
    octets.every(
      (octet, index) =>
        /^\d{1,3}$/.test(value.split('.')[index] ?? '') &&
        octet >= 0 &&
        octet <= 255,
    )
  )
}

function generatedAliasUsesHttps(serverPublicAddress: string | null) {
  const value = resolveRoutingIpv4(serverPublicAddress)
  const octets = value.split('.').map((part) => Number.parseInt(part, 10))

  const [first = 0, second = 0] = octets

  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 0 && octets[2] === 2) ||
    (first === 198 && second === 51 && octets[2] === 100) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    (first === 192 && second === 168)
  )
}

async function requireAvailableProjectMachineName(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  teamId: string,
  slug: string,
  projectId?: string,
) {
  const duplicateRows = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.teamId, teamId),
        sql`lower(${projects.slug}) = lower(${slug})`,
        ne(projects.status, 'deleted'),
        projectId ? ne(projects.id, projectId) : undefined,
      ),
    )
    .limit(1)

  if (duplicateRows.at(0)) {
    throw new Error('Project names must be unique within a team.')
  }
}

async function createDeploymentForEnvironment({
  deploymentId = crypto.randomUUID(),
  environmentId,
  gitBranch,
  gitSha,
  trigger,
  commitMeta,
  queuedMessage,
  createdByUserId,
}: {
  deploymentId?: string
  environmentId: string
  gitBranch: string
  gitSha: string
  trigger: 'user' | 'webhook' | 'api' | 'rollback'
  commitMeta: DeploymentCommitMeta
  queuedMessage: string
  createdByUserId?: string
}): Promise<{ status: 'created'; deploymentId: string }> {
  const now = new Date()
  const environmentRows = await db
    .select({
      environment: environments,
      project: projects,
      server: servers,
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .leftJoin(
      servers,
      eq(
        servers.id,
        sql`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
      ),
    )
    .where(eq(environments.id, environmentId))
    .limit(1)
  const environmentRow = environmentRows.at(0)

  if (!environmentRow) {
    throw new Error('Deployment environment not found.')
  }

  if (!environmentRow.server) {
    throw new Error('Assign a server before deploying.')
  }
  if (!environmentRow.project.githubRepoId) {
    throw new Error('Project repository is not configured.')
  }
  const server = environmentRow.server
  const repoId = environmentRow.project.githubRepoId

  if (server.status === 'deleted') {
    throw new Error('Assigned server was deleted. Choose another server.')
  }

  const [aliasRows, domainRows] = await Promise.all([
    db
      .select()
      .from(aliases)
      .where(
        and(
          eq(aliases.projectId, environmentRow.project.id),
          eq(aliases.environmentId, environmentRow.environment.id),
        ),
      ),
    db
      .select()
      .from(domains)
      .where(
        and(
          eq(domains.projectId, environmentRow.project.id),
          eq(domains.environmentId, environmentRow.environment.id),
        ),
      ),
  ])

  const branchAlias = aliasRows.find(
    (alias) => alias.type === 'branch' && alias.branch === gitBranch,
  )
  const requestedBranchAliasHostname =
    branchAlias?.hostname ??
    buildBranchAliasHostname({
      branch: gitBranch,
      projectName: environmentRow.project.name,
      serverPublicAddress: server.publicAddress,
    })
  const branchAliasHostname = await resolveAvailableAliasHostname({
    excludeAliasId: branchAlias?.id,
    hostname: requestedBranchAliasHostname,
    uniquenessKey: `${environmentRow.project.id}:${gitBranch}`,
  })
  const requestedDeploymentAliasHostname = buildDeploymentAliasHostname({
    deploymentId,
    projectName: environmentRow.project.name,
    serverPublicAddress: server.publicAddress,
  })
  const deploymentAliasHostname = await resolveAvailableAliasHostname({
    hostname: requestedDeploymentAliasHostname,
    uniquenessKey: deploymentId,
  })
  const deploymentConfig = createDeploymentConfig({
    environment: environmentRow.environment,
    aliasRows,
    domainRows,
    gitBranch,
    extraHostnames: [
      {
        hostname: branchAliasHostname,
        environmentId,
        basePath: null,
        https: generatedAliasUsesHttps(server.publicAddress),
      },
      {
        hostname: deploymentAliasHostname,
        environmentId,
        basePath: null,
        https: generatedAliasUsesHttps(server.publicAddress),
      },
    ],
    project: environmentRow.project,
  })
  const envVars = encryptDeploymentEnvVars(
    getDeploymentEnvVars({
      environment: environmentRow.environment,
      project: environmentRow.project,
    }),
  )

  await db.transaction(async (tx) => {
    await cancelActiveDeploymentsForEnvironment(tx, {
      environmentId,
      message: `Canceled because a newer ${trigger} deployment was queued.`,
      now,
    })

    await tx.insert(deployments).values({
      id: deploymentId,
      environmentId,
      status: 'queued',
      phase: 'queued',
      trigger,
      serverId: server.id,
      repoId,
      repoFullName: environmentRow.project.githubRepo,
      gitSha,
      gitBranch,
      commitMeta,
      config: deploymentConfig,
      envVars,
      runtimeId: environmentRow.environment.runtimeId,
      createdByUserId,
    })

    await tx.insert(deploymentLogs).values({
      deploymentId,
      stream: 'deploy',
      seq: 1,
      content: queuedMessage,
      createdAt: now,
    })

    if (!branchAlias) {
      await tx.insert(aliases).values({
        id: crypto.randomUUID(),
        projectId: environmentRow.project.id,
        environmentId,
        hostname: branchAliasHostname,
        type: 'branch',
        branch: gitBranch,
        https: generatedAliasUsesHttps(server.publicAddress),
        updatedAt: now,
      })
    }

    await tx.insert(aliases).values({
      id: crypto.randomUUID(),
      projectId: environmentRow.project.id,
      deploymentId,
      hostname: deploymentAliasHostname,
      type: 'deployment',
      environmentId: environmentRow.environment.id,
      https: generatedAliasUsesHttps(server.publicAddress),
      updatedAt: now,
    })
  })

  return { status: 'created', deploymentId }
}

function createDeploymentConfig({
  environment,
  aliasRows,
  domainRows,
  extraHostnames = [],
  gitBranch,
  project,
}: {
  environment: typeof environments.$inferSelect
  aliasRows: Array<typeof aliases.$inferSelect>
  domainRows: Array<typeof domains.$inferSelect>
  extraHostnames?: Array<RouteHostname>
  gitBranch: string
  project: typeof projects.$inferSelect
}): DeploymentConfig {
  const { routes } = resolveDeploymentPublicRoutes({
    environment,
    aliasRows,
    domainRows,
    extraHostnames,
    gitBranch,
    project,
  })
  const releaseService = project.releaseService ?? routes.at(0)?.service

  if (!releaseService) {
    throw new Error('Configure a release service before deploying.')
  }

  return {
    version: 2,
    composePath: project.composePath ?? 'compose.yml',
    releaseCommand: project.releaseCommand,
    releaseService,
    readinessPath: project.readinessPath,
    routes,
  }
}

function resolveDeploymentPublicRoutes({
  environment,
  aliasRows,
  domainRows,
  extraHostnames = [],
  gitBranch,
  project,
}: {
  environment: typeof environments.$inferSelect
  aliasRows: Array<typeof aliases.$inferSelect>
  domainRows: Array<typeof domains.$inferSelect>
  extraHostnames?: Array<RouteHostname>
  gitBranch?: string
  project: typeof projects.$inferSelect
}) {
  const projectRoutes = normalizeProjectRoutes(project.routes)
  const environmentAliases = aliasRows.filter(
    (alias) =>
      alias.environmentId === environment.id &&
      (alias.type === 'environment' ||
        (alias.type === 'branch' && alias.branch === gitBranch)),
  )
  const environmentDomains = domainRows.filter(
    (domain) =>
      domain.environmentId === environment.id &&
      (domain.status === 'pending' || domain.status === 'active'),
  )
  const routeHostnames = toRouteHostnames(
    environmentAliases,
    environmentDomains,
  ).concat(extraHostnames)
  const defaultHost = environmentAliases.at(0)?.hostname ?? null
  const routes = expandPublicRoutesFromHostnames(projectRoutes, routeHostnames)

  return {
    defaultHost,
    routes,
  }
}

function getDeploymentEnvVars({
  environment,
  project,
}: {
  environment: typeof environments.$inferSelect
  project: typeof projects.$inferSelect
}): Array<DeploymentEnvVar> {
  return getEnvVarsForEnvironment(
    normalizeEnvVars(project.envVars),
    environment.id,
  ).map((envVar) => ({
    key: envVar.key,
    value: envVar.value,
  }))
}

function normalizeDeploymentCommitMeta(value: unknown): DeploymentCommitMeta {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const record = value as Record<string, unknown>

    return {
      message: typeof record.message === 'string' ? record.message : null,
      authorName:
        typeof record.authorName === 'string' ? record.authorName : null,
      authoredAt:
        typeof record.authoredAt === 'string' ? record.authoredAt : null,
      url: typeof record.url === 'string' ? record.url : null,
    }
  }

  return {
    message: null,
    authorName: null,
    authoredAt: null,
    url: null,
  }
}

async function cancelActiveDeploymentsForEnvironment(
  tx: DbTransaction,
  {
    environmentId,
    message,
    now,
  }: {
    environmentId: string
    message: string
    now: Date
  },
) {
  const activeRows = await tx
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.environmentId, environmentId),
        inArray(deployments.status, ['queued', 'running']),
      ),
    )
  const activeIds = activeRows.map((row) => row.id)

  if (activeIds.length === 0) {
    return []
  }

  const nextSeqRows = await tx
    .select({
      deploymentId: deploymentLogs.deploymentId,
      value: sql<number>`coalesce(max(${deploymentLogs.seq}), 0) + 1`,
    })
    .from(deploymentLogs)
    .where(inArray(deploymentLogs.deploymentId, activeIds))
    .groupBy(deploymentLogs.deploymentId)
  const nextSeqByDeployment = new Map(
    nextSeqRows.map((row) => [row.deploymentId, Number(row.value)]),
  )

  const canceledRows = await tx
    .update(deployments)
    .set({
      status: 'canceled',
      phase: 'canceled',
      errorMessage: message,
      finishedAt: now,
    })
    .where(
      and(
        inArray(deployments.id, activeIds),
        inArray(deployments.status, ['queued', 'running']),
      ),
    )
    .returning({ id: deployments.id })
  const canceledIds = canceledRows.map((row) => row.id)

  if (canceledIds.length === 0) {
    return []
  }

  await tx
    .insert(deploymentLogs)
    .values(
      canceledIds.map((deploymentId) => ({
        deploymentId,
        stream: 'deploy',
        seq: nextSeqByDeployment.get(deploymentId) ?? 1,
        content: message,
        createdAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [
        deploymentLogs.deploymentId,
        deploymentLogs.stream,
        deploymentLogs.seq,
      ],
    })

  return canceledIds
}
