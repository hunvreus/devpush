import { notifyProject } from '@/server/realtime/service'
import { enqueueDeployment } from './queue-state'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { canAgentRunDeployments } from '@/server/agents/compatibility'
import {
  aliases,
  deployments,
  domains,
  environments,
  projects,
  servers,
} from '@/server/db/schema'
import {
  createInstallationAccessToken,
  getBranchHeadCommit,
  listBranchCommits,
  listRepositoryBranches,
} from '@/server/github/service'
import {
  encryptDeploymentEnvVars,
  normalizeDeploymentCommitMeta,
  parseDeploymentConfig,
  toDeploymentCommitMeta,
} from './deployment-config'
import {
  getEnvironmentForBranch,
  groupBranchesByEnvironment,
} from './environment-branches'
import {
  buildBranchAliasHostname,
  buildDeploymentAliasHostname,
  generatedAliasUsesHttps,
  replaceDeploymentAliasRoutes,
  resolveAvailableAliasHostname,
} from './hostnames'
import type {
  DeploymentCommitMeta,
  DeploymentConfig,
  DeploymentEnvVar,
} from './deployment-config'
import { getEffectiveServerStatus } from '@/server/servers/status'
import { requireProjectRuntimeConfig } from './runtime-config'
import { getProjectContext } from './context'
import {
  expandPublicRoutesFromHostnames,
  getEffectiveProjectRoutes,
  getEnvVarsForEnvironment,
  mapEnvironmentConfig,
  normalizeProjectRoutes,
  toRouteHostnames,
} from './mappers'
import type { RouteHostname } from './mappers'
import { readProjectEnvVars } from './project-env-vars'

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
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
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

  if (
    !canAgentRunDeployments({
      protocolVersion: environmentRow.server.agentProtocolVersion,
      capabilities: environmentRow.server.agentCapabilities,
    })
  ) {
    throw new Error('Update the assigned server agent before deploying.')
  }

  if (!context.project.githubInstallationId || !context.project.githubRepoId) {
    throw new Error('Connect a GitHub App installation before deploying.')
  }

  const installationToken = await createInstallationAccessToken({
    installationId: context.project.githubInstallationId,
    repositoryId: context.project.githubRepoId,
    repositoryFullName: context.project.githubRepo,
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
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
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

  if (
    !canAgentRunDeployments({
      protocolVersion: deploymentServer.agentProtocolVersion,
      capabilities: deploymentServer.agentCapabilities,
    })
  ) {
    throw new Error('Update the deployment server agent before rolling back.')
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

  const created = await enqueueDeployment(db, {
    deployment: {
      id: rollbackDeploymentId,
      environmentId: source.environmentId,
      serverId: deploymentServer.id,
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
    },
    projectId: context.project.id,
    hostname: rollbackAliasHostname,
    https: generatedAliasUsesHttps(deploymentServer.publicAddress),
    queuedMessage: `Queued rollback to ${source.gitSha.slice(0, 7)} for ${environmentName}.`,
    canceledMessage: 'Canceled because a rollback deployment was queued.',
    now,
  })

  if (!created) throw new Error('Deployment environment is no longer active.')
  await notifyProject(context.project.id)

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
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
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

  if (
    !canAgentRunDeployments({
      protocolVersion: deploymentServer.agentProtocolVersion,
      capabilities: deploymentServer.agentCapabilities,
    })
  ) {
    throw new Error('Update the deployment server agent before redeploying.')
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

  const created = await enqueueDeployment(db, {
    deployment: {
      id: redeploymentId,
      environmentId: source.environmentId,
      serverId: deploymentServer.id,
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
    },
    projectId: context.project.id,
    hostname: redeploymentAliasHostname,
    https: generatedAliasUsesHttps(deploymentServer.publicAddress),
    queuedMessage: `Queued redeploy of ${source.gitSha.slice(0, 7)} for ${environmentName}.`,
    canceledMessage: 'Canceled because a redeployment was queued.',
    now,
  })

  if (!created) throw new Error('Deployment environment is no longer active.')
  await notifyProject(context.project.id)

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
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
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
    repositoryFullName: context.project.githubRepo,
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
  deliveryId,
  installationId,
  repositoryId,
  repositoryFullName,
  branch,
  gitSha,
  message,
}: {
  deliveryId: string
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

    if (
      !canAgentRunDeployments({
        protocolVersion: row.server.agentProtocolVersion,
        capabilities: row.server.agentCapabilities,
      })
    ) {
      skipped.push({
        projectId: row.project.id,
        environmentId: row.environment.id,
        reason: 'agent_update_required',
      })
      continue
    }

    const deployment = await createDeploymentForEnvironment({
      githubDeliveryId: deliveryId,
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

    if (deployment.status === 'created') {
      created.push({
        deploymentId: deployment.deploymentId,
        projectId: row.project.id,
        environmentId: row.environment.id,
      })
    } else {
      skipped.push({
        projectId: row.project.id,
        environmentId: row.environment.id,
        reason: 'duplicate_delivery',
      })
    }
  }

  return {
    matched: rows.length,
    created,
    skipped,
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
  githubDeliveryId,
}: {
  deploymentId?: string
  environmentId: string
  gitBranch: string
  gitSha: string
  trigger: 'user' | 'webhook' | 'api' | 'rollback'
  commitMeta: DeploymentCommitMeta
  queuedMessage: string
  createdByUserId?: string
  githubDeliveryId?: string
}): Promise<{
  status: 'created' | 'existing'
  deploymentId: string
}> {
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

  const created = await enqueueDeployment(db, {
    deployment: {
      id: deploymentId,
      environmentId,
      trigger,
      githubDeliveryId,
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
    },
    projectId: environmentRow.project.id,
    hostname: deploymentAliasHostname,
    branchHostname: branchAlias ? undefined : branchAliasHostname,
    https: generatedAliasUsesHttps(server.publicAddress),
    queuedMessage,
    canceledMessage: `Canceled because a newer ${trigger} deployment was queued.`,
    now,
  })

  if (created) await notifyProject(environmentRow.project.id)
  return { status: created ? 'created' : 'existing', deploymentId }
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
  const runtime = requireProjectRuntimeConfig(project.runtimeConfig)
  const releaseService = runtime.releaseService ?? routes.at(0)?.service ?? null

  return {
    schemaVersion: 1,
    runtime: {
      ...runtime,
      path: runtime.path ?? 'compose.yml',
      releaseService,
    },
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
  const projectRoutes = getEffectiveProjectRoutes(
    normalizeProjectRoutes(project.routes),
    environment.id,
  )
  const environmentAliases = aliasRows.filter(
    (alias) =>
      alias.environmentId === environment.id &&
      (alias.type === 'environment' ||
        (alias.type === 'branch' && alias.branch === gitBranch)),
  )
  const environmentDomains = domainRows.filter(
    (domain) =>
      domain.environmentId === environment.id && domain.status === 'active',
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
    readProjectEnvVars(project),
    environment.id,
  ).map((envVar) => ({
    key: envVar.key,
    value: envVar.value,
  }))
}
