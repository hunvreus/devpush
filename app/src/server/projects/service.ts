import { and, desc, eq, gte, ilike, inArray, ne, sql } from 'drizzle-orm'

import { db } from '@/server/db'
import { config } from '@/server/config'
import { enqueueProjectDeprovisionJobs } from '@/server/agents/cleanup'
import { failStaleRunningDeploymentsForServer } from '@/server/agents/jobs'
import {
  backupConfigs,
  deployments,
  deploymentLogs,
  environments,
  hostnames,
  projectServers,
  projects,
  runtimeLogs,
  servers,
} from '@/server/db/schema'
import {
  detectComposePath,
  createInstallationAccessToken,
  getBranchHeadCommit,
  getRepositoryCommit,
  getGitHubAccount,
  getGitHubRepository,
  getGitHubAppInstallUrl,
  isGitHubAppConfigured,
  listBranchCommits,
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
  parseDeploymentConfigSnapshot,
  toDeploymentCommitMeta,
} from './deployment-snapshot'
import type {
  DeploymentCommitMeta,
  DeploymentConfigSnapshot,
  DeploymentSnapshotEnvVar,
} from './deployment-snapshot'
import type {
  BackupDatabaseDump,
  BackupDestination,
  BackupRetentionPolicy,
} from '@/server/backups/service'
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
  generated: boolean
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
  status: 'active' | 'deleted'
}

export type ProjectServerAssignment = {
  environment: string
  serverId: string
}

export type ProjectBackupConfig = {
  environmentId: string
  enabled: boolean
  destination: BackupDestination
  retention: BackupRetentionPolicy
  databaseDumps: Array<BackupDatabaseDump>
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
    avatarUrl: string | null
    composePath: string | null
    releaseCommand: string | null
    readinessPath: string | null
    color: ReturnType<typeof getResourceColor>
  }
  teamProjects: Array<ProjectSummary>
  routes: Array<ProjectRoute>
  domains: Array<ProjectDomain>
  envVars: Array<ProjectEnvironmentVariable>
  backupConfigs: Array<ProjectBackupConfig>
  environment: {
    id: string
    name: string
    slug: string
    branch: string
    color: string
    defaultHost: string | null
    serverId: string | null
    serverName: string | null
    serverStatus: ServerStatus | null
    envVars: Array<ProjectEnvironmentVariable>
    publicRoutes: Array<ProjectPublicRoute>
  }
  environments: Array<ProjectEnvironmentConfig>
  serverAssignments: Array<ProjectServerAssignment>
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
  serverAssignments: Array<ProjectServerAssignment>
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
    const defaultHost = buildDefaultHostForProject({
      projectName: slug,
      serverPublicAddress: server?.publicAddress ?? null,
    })

    await tx.insert(projects).values({
      id: projectId,
      teamId: team.id,
      slug,
      name: slug,
      githubRepoId: repo.id,
      githubRepo: repo.fullName,
      githubInstallationId: installationId,
      environments: [
        {
          id: productionEnvironmentId,
          name: 'Production',
          slug: 'production',
          branch: repo.defaultBranch,
          color: 'blue',
          status: 'active',
        },
      ],
      routes: [{ path: '/', service: 'web', port: 3000, stripPrefix: false }],
      envVars: scopedProjectEnvVars,
      composePath: projectComposePath,
    })

    if (server) {
      await tx.insert(projectServers).values({
        id: crypto.randomUUID(),
        projectId,
        environmentId: null,
        serverId: server.id,
      })
    }

    await tx.insert(hostnames).values({
      id: crypto.randomUUID(),
      projectId,
      hostname: defaultHost,
      type: 'environment_alias',
      environmentId: productionEnvironmentId,
      https: true,
      status: 'active',
    })

    await tx.insert(environments).values({
      id: productionEnvironmentId,
      projectId,
      serverId: server?.id ?? null,
      name: 'Production',
      slug: 'production',
      branch: repo.defaultBranch,
      isProduction: true,
      defaultHost,
      runtimeId: buildComposeProjectName({
        projectId,
        environmentId: productionEnvironmentId,
      }),
      envVars: getEnvVarsForEnvironment(
        scopedProjectEnvVars,
        productionEnvironmentId,
      ),
      publicRoutes: [
        {
          host: defaultHost,
          service: 'web',
          port: 3000,
          path: '/',
          https: true,
          stripPrefix: false,
        },
      ],
    })

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
    .leftJoin(servers, eq(servers.id, environments.serverId))
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

  if (row.environment.serverId) {
    await failStaleRunningDeploymentsForServer(row.environment.serverId)
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

  const projectEnvironments = normalizeProjectEnvironments(
    row.project.environments,
    row.environment,
  )
  const projectEnvVars = normalizeEnvVars(row.project.envVars)
  const [teamServers, projectServerRows, hostnameRows, backupConfigRows] =
    await Promise.all([
      listTeamServers(team.id),
      db
        .select({
          environmentId: projectServers.environmentId,
          serverId: projectServers.serverId,
        })
        .from(projectServers)
        .where(eq(projectServers.projectId, row.project.id)),
      db
        .select()
        .from(hostnames)
        .where(eq(hostnames.projectId, row.project.id)),
      db
        .select()
        .from(backupConfigs)
        .where(eq(backupConfigs.projectId, row.project.id)),
    ])
  const serverAssignments = normalizeServerAssignments(
    projectServerRows.map((assignment) => ({
      environment: assignment.environmentId ?? '',
      serverId: assignment.serverId,
    })),
    row.environment.serverId,
  )
  const productionServerId = resolveServerAssignment(
    serverAssignments,
    getProductionEnvironment(projectEnvironments).id,
  )
  const productionServer =
    teamServers.find((server) => server.id === productionServerId) ?? null
  const projectRoutes = normalizeProjectRoutes(row.project.routes)
  const productionEnvironment = getProductionEnvironment(projectEnvironments)
  const productionHostnames = hostnameRows.filter(
    (hostname) =>
      hostname.environmentId === productionEnvironment.id &&
      (hostname.type === 'environment_alias' ||
        hostname.type === 'custom_domain'),
  )
  const productionPublicRoutes = expandPublicRoutesFromHostnames(
    projectRoutes,
    productionHostnames,
  )
  const productionDefaultHost =
    productionHostnames.find(
      (hostname) => hostname.type === 'environment_alias',
    )?.hostname ??
    row.environment.defaultHost ??
    null

  return {
    userContext,
    team,
    project: mapProject(row.project),
    teamProjects: await listTeamProjects(team.id),
    routes: projectRoutes,
    domains: mapProjectDomains(hostnameRows),
    envVars: projectEnvVars,
    backupConfigs: backupConfigRows.map(mapBackupConfig),
    environment: {
      ...mapEnvironment(row.environment, row.server),
      defaultHost: productionDefaultHost,
      color: productionEnvironment.color,
      serverId: productionServer?.id ?? null,
      serverName: productionServer?.name ?? null,
      serverStatus: productionServer?.status ?? null,
      envVars: getEnvVarsForEnvironment(projectEnvVars, 'production'),
      publicRoutes: productionPublicRoutes,
    },
    environments: projectEnvironments,
    serverAssignments,
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
    serverAssignments: context.serverAssignments,
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

    await tx
      .update(hostnames)
      .set({ status: 'disabled', updatedAt: now })
      .where(eq(hostnames.projectId, context.project.id))
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

    const hostnameRows = await tx
      .select()
      .from(hostnames)
      .where(eq(hostnames.projectId, context.project.id))

    for (const hostname of hostnameRows) {
      if (hostname.basePath && !routePaths.has(hostname.basePath)) {
        await tx
          .update(hostnames)
          .set({ basePath: null, updatedAt: now })
          .where(eq(hostnames.id, hostname.id))
      }
    }

    await syncProjectRuntimeRoutes({
      tx,
      projectId: context.project.id,
      routes: normalizedRoutes,
      now,
    })
  })

  return getProjectContext({ userId, teamSlug, projectName })
}

export async function updateProjectDomains({
  userId,
  teamSlug,
  projectName,
  domains,
}: {
  userId: string
  teamSlug: string
  projectName: string
  domains: Array<Omit<ProjectDomain, 'id' | 'generated' | 'status'>>
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const routePaths = new Set(context.routes.map((route) => route.path))
  const normalizedDomains = domains.map((domain) => ({
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
    await tx
      .delete(hostnames)
      .where(
        and(
          eq(hostnames.projectId, context.project.id),
          eq(hostnames.type, 'custom_domain'),
        ),
      )

    if (normalizedDomains.length > 0) {
      const values: Array<typeof hostnames.$inferInsert> =
        normalizedDomains.map((domain) => ({
          id: crypto.randomUUID(),
          projectId: context.project.id,
          hostname: domain.host,
          type: 'custom_domain',
          environmentId: domain.environmentId,
          basePath: domain.basePath,
          https: domain.https,
          status: 'pending',
          updatedAt: now,
        }))

      await tx.insert(hostnames).values(values)
    }

    await syncProjectRuntimeRoutes({
      tx,
      projectId: context.project.id,
      routes: context.routes,
      now,
    })
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
}: {
  userId: string
  teamSlug: string
  projectName: string
  projectEnvironments: Array<ProjectEnvironmentConfig>
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

  await db.transaction(async (tx) => {
    const [environmentRows, hostnameRows] = await Promise.all([
      tx
        .select()
        .from(environments)
        .where(eq(environments.projectId, context.project.id)),
      tx
        .select()
        .from(hostnames)
        .where(eq(hostnames.projectId, context.project.id)),
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

    await tx
      .update(projects)
      .set({ environments: reconciledEnvironments, updatedAt: now })
      .where(eq(projects.id, context.project.id))

    for (const environment of reconciledEnvironments) {
      const existing = environmentById.get(environment.id)
      const existingAlias = hostnameRows.find(
        (hostname) =>
          hostname.type === 'environment_alias' &&
          hostname.environmentId === environment.id,
      )
      const serverId = resolveServerAssignment(
        context.serverAssignments,
        environment.id,
      )
      const defaultHost =
        existingAlias?.hostname ??
        buildDefaultHostForEnvironment({
          environmentSlug: environment.slug,
          projectName: context.project.name,
          serverPublicAddress:
            context.servers.find((server) => server.id === serverId)
              ?.publicAddress ?? null,
        })
      const environmentHostnames = hostnameRows.filter(
        (hostname) =>
          hostname.environmentId === environment.id &&
          (hostname.type === 'custom_domain' ||
            hostname.type === 'environment_alias'),
      )
      const routeHostnames: Array<typeof hostnames.$inferSelect> = existingAlias
        ? environmentHostnames.map((hostname) =>
            hostname.id === existingAlias.id
              ? { ...hostname, hostname: defaultHost, status: 'active' }
              : hostname,
          )
        : [
            ...environmentHostnames,
            {
              id: crypto.randomUUID(),
              projectId: context.project.id,
              deploymentId: null,
              hostname: defaultHost,
              type: 'environment_alias',
              environmentId: environment.id,
              basePath: null,
              https: true,
              status: 'active',
              message: null,
              verifiedAt: null,
              createdAt: now,
              updatedAt: now,
            },
          ]
      const publicRoutes = expandPublicRoutesFromHostnames(
        context.routes,
        routeHostnames,
      )

      if (existing) {
        await tx
          .update(environments)
          .set({
            name: environment.name,
            slug: environment.slug,
            branch: environment.branch,
            serverId,
            defaultHost,
            isProduction: environment.id === reconciledProduction.id,
            envVars: getEnvVarsForEnvironment(context.envVars, environment.id),
            publicRoutes,
            updatedAt: now,
          })
          .where(eq(environments.id, existing.id))
      } else {
        await tx.insert(environments).values({
          id: environment.id,
          projectId: context.project.id,
          serverId,
          name: environment.name,
          slug: environment.slug,
          branch: environment.branch,
          isProduction: environment.id === reconciledProduction.id,
          defaultHost,
          runtimeId: buildComposeProjectName({
            projectId: context.project.id,
            environmentId: environment.id,
          }),
          envVars: getEnvVarsForEnvironment(context.envVars, environment.id),
          publicRoutes,
          updatedAt: now,
        })
      }

      if (!existingAlias) {
        await tx.insert(hostnames).values({
          id: crypto.randomUUID(),
          projectId: context.project.id,
          hostname: defaultHost,
          type: 'environment_alias',
          environmentId: environment.id,
          https: true,
          status: 'active',
          updatedAt: now,
        })
      } else if (existingAlias.hostname !== defaultHost) {
        await tx
          .update(hostnames)
          .set({ hostname: defaultHost, status: 'active', updatedAt: now })
          .where(eq(hostnames.id, existingAlias.id))
      }
    }

    for (const hostname of hostnameRows) {
      if (
        (hostname.type === 'custom_domain' ||
          hostname.type === 'environment_alias') &&
        hostname.environmentId &&
        !activeEnvironmentIds.has(hostname.environmentId)
      ) {
        await tx
          .update(hostnames)
          .set({
            status: 'disabled',
            message: 'Environment was deleted.',
            updatedAt: now,
          })
          .where(eq(hostnames.id, hostname.id))
      }
    }
  })

  return getProjectContext({ userId, teamSlug, projectName })
}

export async function updateProjectServerAssignments({
  userId,
  teamSlug,
  projectName,
  serverAssignments,
}: {
  userId: string
  teamSlug: string
  projectName: string
  serverAssignments: Array<ProjectServerAssignment>
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const normalizedAssignments = serverAssignments.filter(
    (assignment) => assignment.serverId,
  )

  const duplicateEnvironment = findDuplicate(
    normalizedAssignments.map((assignment) => assignment.environment),
  )

  if (duplicateEnvironment !== null) {
    throw new Error('Each environment can only have one server assignment.')
  }

  for (const assignment of normalizedAssignments) {
    const server = context.servers.find(
      (candidate) => candidate.id === assignment.serverId,
    )

    if (!server) {
      throw new Error('Select a valid server.')
    }
  }

  const productionServerId = resolveServerAssignment(
    normalizedAssignments,
    getProductionEnvironment(context.environments).id,
  )

  await db.transaction(async (tx) => {
    await tx
      .delete(projectServers)
      .where(eq(projectServers.projectId, context.project.id))

    if (normalizedAssignments.length > 0) {
      await tx.insert(projectServers).values(
        normalizedAssignments.map((assignment) => ({
          id: crypto.randomUUID(),
          projectId: context.project.id,
          environmentId: assignment.environment || null,
          serverId: assignment.serverId,
        })),
      )
    }

    await tx
      .update(environments)
      .set({ serverId: productionServerId, updatedAt: new Date() })
      .where(eq(environments.id, context.environment.id))

    await tx
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, context.project.id))
  })

  return getProjectContext({ userId, teamSlug, projectName })
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

  const currentEnvironmentEnvVars = getEnvVarsForEnvironment(
    normalizedEnvVars,
    context.environment.id,
  )

  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ envVars: normalizedEnvVars, updatedAt: new Date() })
      .where(eq(projects.id, context.project.id))

    await tx
      .update(environments)
      .set({ envVars: currentEnvironmentEnvVars, updatedAt: new Date() })
      .where(eq(environments.id, context.environment.id))
  })

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
  backupConfigs: Array<ProjectBackupConfig>
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })
  const environmentIds = new Set(context.environments.map((item) => item.id))
  const normalizedConfigs = nextBackupConfigs
    .filter((item) => item.environmentId.trim() !== '')
    .map((item) => ({
      environmentId: item.environmentId,
      enabled: item.enabled,
      destination: {
        bucket: item.destination.bucket.trim(),
        region: item.destination.region?.trim() || undefined,
        endpoint: item.destination.endpoint?.trim() || undefined,
        prefix: item.destination.prefix?.trim() || undefined,
      },
      retention: item.retention,
      databaseDumps: item.databaseDumps.map((dump) => ({
        service: dump.service.trim(),
        command: dump.command.trim(),
        output: dump.output.trim(),
      })),
    }))
  const duplicateEnvironment = findDuplicate(
    normalizedConfigs.map((item) => item.environmentId),
  )

  if (duplicateEnvironment) {
    throw new Error('Each environment can only have one backup configuration.')
  }

  for (const backupConfig of normalizedConfigs) {
    if (!environmentIds.has(backupConfig.environmentId)) {
      throw new Error('Select a valid backup environment.')
    }

    if (!backupConfig.destination.bucket) {
      throw new Error('Backup bucket is required.')
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
          id: crypto.randomUUID(),
          projectId: context.project.id,
          environmentId: backupConfig.environmentId,
          enabled: backupConfig.enabled,
          destinationType: 's3',
          destination: backupConfig.destination,
          retention: backupConfig.retention,
          databaseDumps: backupConfig.databaseDumps,
          createdAt: now,
          updatedAt: now,
        }))

      await tx.insert(backupConfigs).values(values)
    }
  })

  return getProjectContext({ userId, teamSlug, projectName })
}

export async function createManualDeployment({
  gitSha,
  userId,
  teamSlug,
  projectName,
}: {
  gitSha?: string | null
  userId: string
  teamSlug: string
  projectName: string
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })

  if (!context.environment.serverId) {
    throw new Error('Assign a server before deploying.')
  }

  const assignedServerIds = Array.from(
    new Set(
      context.serverAssignments
        .map((assignment) => assignment.serverId)
        .filter(Boolean),
    ),
  )
  const assignedServers = assignedServerIds.map((serverId) =>
    context.servers.find((server) => server.id === serverId),
  )

  if (
    assignedServers.some((server) => !server || server.status !== 'connected')
  ) {
    throw new Error(
      'Wait until every assigned server is connected before deploying.',
    )
  }

  if (context.environment.publicRoutes.length === 0) {
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
    ? await getRepositoryCommit({
        accessToken: installationToken.token,
        repo: context.project.githubRepo,
        sha: gitSha,
      })
    : await getBranchHeadCommit({
        accessToken: installationToken.token,
        branch: context.environment.branch,
        repo: context.project.githubRepo,
      })
  const logMessage = `Queued ${context.project.githubRepo} for ${context.environment.name}.`

  const deployment = await createDeploymentForEnvironment({
    environmentId: context.environment.id,
    gitBranch: context.environment.branch,
    gitSha: commit.sha,
    trigger: 'user',
    commitMessage: commit.message,
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

  const snapshot = parseDeploymentConfigSnapshot(source.configSnapshot)

  if (!snapshot) {
    throw new Error('Deployment snapshot is invalid.')
  }

  const serverRows = await db
    .select()
    .from(servers)
    .where(eq(servers.id, snapshot.server.id))
    .limit(1)
  const snapshottedServer = serverRows.at(0)

  if (!snapshottedServer) {
    throw new Error('Deployment server not found.')
  }

  const serverStatus = getEffectiveServerStatus({
    status: snapshottedServer.status,
    lastSeenAt: snapshottedServer.lastSeenAt,
  })

  if (serverStatus !== 'connected') {
    throw new Error('Reconnect the deployment server before rolling back.')
  }

  const rollbackDeploymentId = crypto.randomUUID()
  const now = new Date()
  const commitMeta = normalizeDeploymentCommitMeta(source.commitMeta)

  await db.transaction(async (tx) => {
    await cancelActiveDeploymentsForEnvironment(tx, {
      environmentId: source.environmentId,
      message: 'Canceled because a rollback deployment was queued.',
      now,
    })

    await tx.insert(deployments).values({
      id: rollbackDeploymentId,
      environmentId: source.environmentId,
      serverId: snapshottedServer.id,
      status: 'queued',
      phase: 'queued',
      trigger: 'rollback',
      repoId: snapshot.repo.id,
      repoFullName: snapshot.repo.fullName,
      gitSha: source.gitSha,
      gitBranch: source.gitBranch,
      commitMessage: source.commitMessage,
      commitMeta,
      configSnapshot: source.configSnapshot,
      envVarsSnapshot: source.envVarsSnapshot,
      runtimeId: source.runtimeId,
      createdByUserId: userId,
    })

    await tx.insert(deploymentLogs).values({
      deploymentId: rollbackDeploymentId,
      stream: 'deploy',
      seq: 1,
      content: `Queued rollback to ${source.gitSha.slice(0, 7)} for ${snapshot.environment.name}.`,
      createdAt: now,
    })

    await tx.insert(hostnames).values({
      id: crypto.randomUUID(),
      projectId: context.project.id,
      deploymentId: rollbackDeploymentId,
      hostname: buildDeploymentAliasHostname({
        deploymentId: rollbackDeploymentId,
        projectName: snapshot.project.name,
        fallbackHost: snapshot.environment.defaultHost,
      }),
      type: 'deployment_alias',
      environmentId: snapshot.environment.id,
      https: true,
      status: 'active',
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

  const snapshot = parseDeploymentConfigSnapshot(source.configSnapshot)

  if (!snapshot) {
    throw new Error('Deployment snapshot is invalid.')
  }

  const serverRows = await db
    .select()
    .from(servers)
    .where(eq(servers.id, snapshot.server.id))
    .limit(1)
  const snapshottedServer = serverRows.at(0)

  if (!snapshottedServer) {
    throw new Error('Deployment server not found.')
  }

  const serverStatus = getEffectiveServerStatus({
    status: snapshottedServer.status,
    lastSeenAt: snapshottedServer.lastSeenAt,
  })

  if (serverStatus !== 'connected') {
    throw new Error('Reconnect the deployment server before redeploying.')
  }

  const redeploymentId = crypto.randomUUID()
  const now = new Date()
  const commitMeta = normalizeDeploymentCommitMeta(source.commitMeta)

  await db.transaction(async (tx) => {
    await cancelActiveDeploymentsForEnvironment(tx, {
      environmentId: source.environmentId,
      message: 'Canceled because a redeployment was queued.',
      now,
    })

    await tx.insert(deployments).values({
      id: redeploymentId,
      environmentId: source.environmentId,
      serverId: snapshottedServer.id,
      status: 'queued',
      phase: 'queued',
      trigger: 'user',
      repoId: snapshot.repo.id,
      repoFullName: snapshot.repo.fullName,
      gitSha: source.gitSha,
      gitBranch: source.gitBranch,
      commitMessage: source.commitMessage,
      commitMeta,
      configSnapshot: source.configSnapshot,
      envVarsSnapshot: source.envVarsSnapshot,
      runtimeId: source.runtimeId,
      createdByUserId: userId,
    })

    await tx.insert(deploymentLogs).values({
      deploymentId: redeploymentId,
      stream: 'deploy',
      seq: 1,
      content: `Queued redeploy of ${source.gitSha.slice(0, 7)} for ${snapshot.environment.name}.`,
      createdAt: now,
    })

    await tx.insert(hostnames).values({
      id: crypto.randomUUID(),
      projectId: context.project.id,
      deploymentId: redeploymentId,
      hostname: buildDeploymentAliasHostname({
        deploymentId: redeploymentId,
        projectName: snapshot.project.name,
        fallbackHost: snapshot.environment.defaultHost,
      }),
      type: 'deployment_alias',
      environmentId: snapshot.environment.id,
      https: true,
      status: 'active',
      updatedAt: now,
    })
  })

  return {
    deploymentId: redeploymentId,
  }
}

export async function getManualDeploymentOptions({
  userId,
  teamSlug,
  projectName,
}: {
  userId: string
  teamSlug: string
  projectName: string
}) {
  const context = await getProjectContext({ userId, teamSlug, projectName })

  if (!context.project.githubInstallationId || !context.project.githubRepoId) {
    throw new Error('Connect a GitHub App installation before deploying.')
  }

  const installationToken = await createInstallationAccessToken({
    installationId: context.project.githubInstallationId,
    repositoryId: context.project.githubRepoId,
  })
  const commits = await listBranchCommits({
    accessToken: installationToken.token,
    branch: context.environment.branch,
    repo: context.project.githubRepo,
    perPage: 5,
  })

  return {
    environment: {
      id: context.environment.id,
      name: context.environment.name,
      branch: context.environment.branch,
      color: context.environment.color,
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
  const rows = await db
    .select({
      project: projects,
      environment: environments,
      server: servers,
    })
    .from(projects)
    .innerJoin(environments, eq(environments.projectId, projects.id))
    .leftJoin(servers, eq(servers.id, environments.serverId))
    .where(
      and(
        eq(projects.githubInstallationId, installationId),
        eq(projects.githubRepoId, repositoryId),
        eq(projects.githubRepo, repositoryFullName),
        eq(projects.status, 'active'),
        eq(environments.branch, branch),
      ),
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
    const [hostnameRows] = await Promise.all([
      db
        .select()
        .from(hostnames)
        .where(
          and(
            eq(hostnames.projectId, row.project.id),
            eq(hostnames.environmentId, row.environment.id),
            inArray(hostnames.type, ['custom_domain', 'environment_alias']),
          ),
        ),
    ])
    const routeCount = resolveDeploymentPublicRoutes({
      environment: row.environment,
      hostnameRows,
      project: row.project,
    }).routes.length
    const serverStatus = row.server
      ? getEffectiveServerStatus({
          status: row.server.status,
          lastSeenAt: row.server.lastSeenAt,
        })
      : null

    if (
      !row.environment.serverId ||
      !row.server ||
      serverStatus !== 'connected'
    ) {
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
      commitMessage: message,
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
    avatarUrl: project.avatarPath,
    composePath: project.composePath,
    releaseCommand: project.releaseCommand,
    readinessPath: project.readinessPath,
    color: getResourceColor(project.id),
  }
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
    color: 'blue',
    defaultHost: environment.defaultHost,
    serverId: environment.serverId,
    serverName: server?.name ?? null,
    serverStatus: server
      ? getEffectiveServerStatus({
          status: server.status,
          lastSeenAt: server.lastSeenAt,
        })
      : null,
    envVars: normalizeEnvVars(environment.envVars),
    publicRoutes: normalizeRoutes(
      environment.publicRoutes,
      environment.defaultHost,
    ),
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
  const snapshot = parseDeploymentConfigSnapshot(deployment.configSnapshot)
  const routes = normalizeRoutes(
    snapshot?.compose.routes ?? environment.publicRoutes,
    snapshot?.environment.defaultHost ?? environment.defaultHost,
  )

  return {
    id: deployment.id,
    status: deployment.status,
    phase: deployment.phase,
    trigger: deployment.trigger,
    gitSha: deployment.gitSha,
    gitBranch: deployment.gitBranch,
    githubRepo: snapshot?.repo.fullName ?? deployment.repoFullName,
    defaultHost: snapshot?.environment.defaultHost ?? environment.defaultHost,
    defaultRouteHttps: routes.at(0)?.https ?? true,
    commitMessage: deployment.commitMessage,
    errorMessage: deployment.errorMessage,
    createdAt: deployment.createdAt.toISOString(),
    startedAt: deployment.startedAt?.toISOString() ?? null,
    finishedAt: deployment.finishedAt?.toISOString() ?? null,
    environmentName: snapshot?.environment.name ?? environment.name,
    environmentSlug: snapshot?.environment.slug ?? environment.slug,
    environmentColor:
      snapshot?.environment.color ??
      getEnvironmentConfigColor(project, environment),
    serverName: server?.name ?? snapshot?.server.name ?? 'Unknown server',
    serverStatus: server
      ? getEffectiveServerStatus({
          status: server.status,
          lastSeenAt: server.lastSeenAt,
        })
      : normalizeDeploymentServerStatus(snapshot?.server.status),
    projectName: snapshot?.project.name ?? project.name,
    projectColor: getResourceColor(project.id),
  }
}

function normalizeDeploymentServerStatus(status: string | null | undefined) {
  if (
    status === 'pending' ||
    status === 'connected' ||
    status === 'disconnected' ||
    status === 'disabled' ||
    status === 'deleted'
  ) {
    return status
  }

  return 'disconnected'
}

function getEnvironmentConfigColor(
  project: typeof projects.$inferSelect,
  environment: typeof environments.$inferSelect,
) {
  const environmentConfig = normalizeProjectEnvironments(
    project.environments,
    environment,
  )
  return (
    environmentConfig.find((item) => item.id === environment.id)?.color ??
    environmentConfig.find((item) => item.slug === environment.slug)?.color ??
    'blue'
  )
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

function normalizeProjectEnvironments(
  value: unknown,
  fallbackEnvironment: typeof environments.$inferSelect,
): Array<ProjectEnvironmentConfig> {
  if (Array.isArray(value)) {
    const environmentsConfig = value
      .filter(
        (item): item is ProjectEnvironmentConfig =>
          typeof item === 'object' &&
          item !== null &&
          'id' in item &&
          'name' in item &&
          'slug' in item &&
          'branch' in item &&
          'color' in item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.slug === 'string' &&
          typeof item.branch === 'string' &&
          typeof item.color === 'string',
      )
      .map((item) => ({
        ...item,
        status:
          item.status === 'deleted'
            ? ('deleted' as const)
            : ('active' as const),
      }))
      .filter((item) => item.status === 'active')

    if (environmentsConfig.length > 0) {
      return environmentsConfig
    }
  }

  return [
    {
      id: fallbackEnvironment.id,
      name: fallbackEnvironment.name,
      slug: fallbackEnvironment.slug,
      branch: fallbackEnvironment.branch,
      color: 'blue',
      status: 'active',
    },
  ]
}

function normalizeServerAssignments(
  value: unknown,
  fallbackServerId: string | null,
): Array<ProjectServerAssignment> {
  if (Array.isArray(value)) {
    const assignments = value
      .filter(
        (item): item is ProjectServerAssignment =>
          typeof item === 'object' &&
          item !== null &&
          'environment' in item &&
          'serverId' in item &&
          typeof item.environment === 'string' &&
          typeof item.serverId === 'string',
      )
      .filter((item) => item.serverId)

    if (assignments.length > 0) {
      return assignments
    }
  }

  return fallbackServerId
    ? [{ environment: '', serverId: fallbackServerId }]
    : []
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

function resolveServerAssignment(
  assignments: Array<ProjectServerAssignment>,
  environment: string,
) {
  return (
    assignments.find((assignment) => assignment.environment === environment)
      ?.serverId ??
    assignments.find((assignment) => assignment.environment === '')?.serverId ??
    null
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

function expandPublicRoutesFromHostnames(
  routes: Array<ProjectRoute>,
  hostnameRows: Array<typeof hostnames.$inferSelect>,
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

function mapProjectDomains(
  hostnameRows: Array<typeof hostnames.$inferSelect>,
): Array<ProjectDomain> {
  return hostnameRows
    .filter((hostname) => hostname.type === 'custom_domain')
    .map((hostname) => ({
      id: hostname.id,
      host: hostname.hostname,
      environmentId: hostname.environmentId ?? '',
      basePath: hostname.basePath,
      https: hostname.https,
      status: hostname.status,
      generated: false,
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
  const retention =
    typeof backupConfig.retention === 'object' &&
    backupConfig.retention !== null
      ? (backupConfig.retention as Partial<BackupRetentionPolicy>)
      : {}
  const databaseDumps = Array.isArray(backupConfig.databaseDumps)
    ? backupConfig.databaseDumps.filter(
        (dump): dump is BackupDatabaseDump =>
          typeof dump === 'object' &&
          dump !== null &&
          'service' in dump &&
          'command' in dump &&
          'output' in dump &&
          typeof dump.service === 'string' &&
          typeof dump.command === 'string' &&
          typeof dump.output === 'string',
      )
    : []

  return {
    environmentId: backupConfig.environmentId,
    enabled: backupConfig.enabled,
    destination: {
      bucket: destination.bucket ?? '',
      region: destination.region,
      endpoint: destination.endpoint,
      prefix: destination.prefix,
    },
    retention: {
      daily: retention.daily ?? 7,
      weekly: retention.weekly ?? 4,
      monthly: retention.monthly ?? 3,
    },
    databaseDumps,
  }
}

async function syncProjectRuntimeRoutes({
  tx,
  projectId,
  routes,
  now,
}: {
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
  projectId: string
  routes: Array<ProjectRoute>
  now: Date
}) {
  const [environmentRows, hostnameRows] = await Promise.all([
    tx.select().from(environments).where(eq(environments.projectId, projectId)),
    tx
      .select()
      .from(hostnames)
      .where(
        and(
          eq(hostnames.projectId, projectId),
          inArray(hostnames.type, ['custom_domain', 'environment_alias']),
        ),
      ),
  ])

  for (const environment of environmentRows) {
    const environmentHostnames = hostnameRows.filter(
      (hostname) => hostname.environmentId === environment.id,
    )
    const environmentAlias = environmentHostnames.find(
      (hostname) => hostname.type === 'environment_alias',
    )

    await tx
      .update(environments)
      .set({
        defaultHost: environmentAlias?.hostname ?? null,
        publicRoutes: expandPublicRoutesFromHostnames(
          routes,
          environmentHostnames,
        ),
        updatedAt: now,
      })
      .where(eq(environments.id, environment.id))
  }
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
  if (serverPublicAddress && isPublicIpv4Address(serverPublicAddress)) {
    return `${projectName}.${serverPublicAddress.replaceAll('.', '-')}.nip.io`
  }

  return `${projectName}.${config.DEVPUSH_DEFAULT_APP_DOMAIN.replace(/^\.+|\.+$/g, '')}`
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
  fallbackHost,
}: {
  deploymentId: string
  projectName: string
  fallbackHost: string | null
}) {
  const suffix = fallbackHost?.includes('.')
    ? fallbackHost.split('.').slice(1).join('.')
    : config.DEVPUSH_DEFAULT_APP_DOMAIN.replace(/^\.+|\.+$/g, '')

  return `${deploymentId.slice(0, 7)}-${projectName}.${suffix}`
}

function isPublicIpv4Address(value: string) {
  const octets = value.split('.').map((part) => Number.parseInt(part, 10))

  if (
    octets.length !== 4 ||
    octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)
  ) {
    return false
  }

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
  commitMessage,
  commitMeta,
  queuedMessage,
  createdByUserId,
}: {
  deploymentId?: string
  environmentId: string
  gitBranch: string
  gitSha: string
  trigger: 'user' | 'webhook' | 'api' | 'rollback'
  commitMessage: string | null
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
    .leftJoin(servers, eq(servers.id, environments.serverId))
    .where(eq(environments.id, environmentId))
    .limit(1)
  const environmentRow = environmentRows.at(0)

  if (!environmentRow) {
    throw new Error('Deployment environment not found.')
  }

  if (!environmentRow.environment.serverId || !environmentRow.server) {
    throw new Error('Assign a server before deploying.')
  }
  const server = environmentRow.server

  if (server.status === 'deleted') {
    throw new Error('Assigned server was deleted. Choose another server.')
  }

  const hostnameRows = await db
    .select()
    .from(hostnames)
    .where(
      and(
        eq(hostnames.projectId, environmentRow.project.id),
        eq(hostnames.environmentId, environmentRow.environment.id),
        inArray(hostnames.type, ['custom_domain', 'environment_alias']),
      ),
    )

  const snapshot = createDeploymentConfigSnapshot({
    environment: environmentRow.environment,
    hostnameRows,
    project: environmentRow.project,
    server,
  })
  const envVarsSnapshot = encryptDeploymentEnvVars(
    getDeploymentEnvVarsSnapshot({
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
      repoId: environmentRow.project.githubRepoId,
      repoFullName: environmentRow.project.githubRepo,
      gitSha,
      gitBranch,
      commitMessage,
      commitMeta,
      configSnapshot: snapshot,
      envVarsSnapshot,
      runtimeId: snapshot.compose.projectName,
      createdByUserId,
    })

    await tx.insert(deploymentLogs).values({
      deploymentId,
      stream: 'deploy',
      seq: 1,
      content: queuedMessage,
      createdAt: now,
    })

    await tx.insert(hostnames).values({
      id: crypto.randomUUID(),
      projectId: environmentRow.project.id,
      deploymentId,
      hostname: buildDeploymentAliasHostname({
        deploymentId,
        projectName: environmentRow.project.name,
        fallbackHost: environmentRow.environment.defaultHost,
      }),
      type: 'deployment_alias',
      environmentId: environmentRow.environment.id,
      https: true,
      status: 'active',
      updatedAt: now,
    })
  })

  return { status: 'created', deploymentId }
}

function createDeploymentConfigSnapshot({
  environment,
  hostnameRows,
  project,
  server,
}: {
  environment: typeof environments.$inferSelect
  hostnameRows: Array<typeof hostnames.$inferSelect>
  project: typeof projects.$inferSelect
  server: typeof servers.$inferSelect
}): DeploymentConfigSnapshot {
  const { defaultHost, routes } = resolveDeploymentPublicRoutes({
    environment,
    hostnameRows,
    project,
  })
  const releaseService = routes.at(0)?.service ?? 'web'
  const serverStatus = getEffectiveServerStatus({
    status: server.status,
    lastSeenAt: server.lastSeenAt,
  })

  return {
    version: 1,
    repo: {
      id: project.githubRepoId,
      fullName: project.githubRepo,
      installationId: project.githubInstallationId,
    },
    project: {
      id: project.id,
      teamId: project.teamId,
      name: project.name,
    },
    environment: {
      id: environment.id,
      name: environment.name,
      slug: environment.slug,
      branch: environment.branch,
      color: getEnvironmentConfigColor(project, environment),
      defaultHost,
    },
    server: {
      id: server.id,
      name: server.name,
      status: serverStatus,
    },
    compose: {
      path: project.composePath ?? 'compose.yml',
      projectName: environment.runtimeId,
      releaseCommand: project.releaseCommand,
      releaseService,
      readinessPath: project.readinessPath,
      routes,
    },
  }
}

function resolveDeploymentPublicRoutes({
  environment,
  hostnameRows,
  project,
}: {
  environment: typeof environments.$inferSelect
  hostnameRows: Array<typeof hostnames.$inferSelect>
  project: typeof projects.$inferSelect
}) {
  const projectRoutes = normalizeProjectRoutes(project.routes)
  const environmentHostnames = hostnameRows.filter(
    (hostname) =>
      hostname.environmentId === environment.id &&
      (hostname.type === 'custom_domain' ||
        hostname.type === 'environment_alias'),
  )
  const environmentAlias = environmentHostnames.find(
    (hostname) => hostname.type === 'environment_alias',
  )
  const defaultHost = environmentAlias?.hostname ?? environment.defaultHost
  const routes = expandPublicRoutesFromHostnames(
    projectRoutes,
    environmentHostnames,
  )

  return {
    defaultHost,
    routes:
      routes.length > 0
        ? routes
        : normalizeRoutes(environment.publicRoutes, defaultHost),
  }
}

function getDeploymentEnvVarsSnapshot({
  environment,
  project,
}: {
  environment: typeof environments.$inferSelect
  project: typeof projects.$inferSelect
}): Array<DeploymentSnapshotEnvVar> {
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
