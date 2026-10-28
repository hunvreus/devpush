import {
  withWorkspaceAccess,
  requireWorkspaceAdmission,
} from '#devpush/server/plugins/workspace-access'
import type { WorkspaceAdmission } from '#devpush/server/plugins/workspace-access'
import { resolveGeneratedHostname } from './generated-hostname'
import type { ApiMutationAdmission } from '#devpush/server/api/admission'
import { PublicError, getPublicErrorMessage } from '#devpush/lib/public-error'
import { safeErrorDiagnostics } from '#devpush/server/http/error-diagnostics'
import { notifyProject } from '#devpush/server/realtime/service'
import { enqueueDeployment } from './queue-state'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '#devpush/server/db'
import { canAgentRunDeployments } from '#devpush/server/agents/compatibility'
import {
  aliases,
  deployments,
  domains,
  environments,
  projects,
  servers,
} from '#devpush/server/db/schema'
import {
  createInstallationAccessToken,
  getBranchHeadCommit,
  listBranchCommits,
  listRepositoryBranches,
} from '#devpush/server/github/service'
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
import { resolveAvailableAliasHostname } from './hostnames'
import type {
  DeploymentCommitMeta,
  DeploymentConfig,
  DeploymentEnvVar,
} from './deployment-config'
import { getEffectiveServerStatus } from '#devpush/server/servers/status'
import { requireProjectRuntimeConfig } from '#devpush/lib/project-runtime-config'
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
  admission,
}: {
  environmentId: string
  gitBranch: string
  gitSha?: string | null
  userId: string
  teamSlug: string
  projectName: string
  admission?: ApiMutationAdmission
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  return withWorkspaceAccess(
    context.team.id,
    'deployment.create',
    async (workspaceAdmission) => {
      const environmentConfig = context.environments.find(
        (environment) => environment.id === environmentId,
      )

      if (!environmentConfig) {
        throw new PublicError('DEPLOYMENT_ENVIRONMENT_NOT_FOUND')
      }

      const matchedEnvironment = getEnvironmentForBranch(
        gitBranch,
        context.environments,
      )

      if (matchedEnvironment?.id !== environmentConfig.id) {
        throw new PublicError('DEPLOYMENT_BRANCH_MISMATCH')
      }

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
        .where(
          and(
            eq(environments.id, environmentConfig.id),
            eq(environments.projectId, context.project.id),
          ),
        )
        .limit(1)
      const environmentRow = environmentRows.at(0)

      if (!environmentRow?.server) {
        throw new PublicError('DEPLOYMENT_SERVER_REQUIRED')
      }

      if (
        getEffectiveServerStatus({
          status: environmentRow.server.status,
          lastSeenAt: environmentRow.server.lastSeenAt,
        }) !== 'connected'
      ) {
        throw new PublicError('DEPLOYMENT_SERVER_OFFLINE')
      }

      if (
        !canAgentRunDeployments({
          protocolVersion: environmentRow.server.agentProtocolVersion,
          capabilities: environmentRow.server.agentCapabilities,
        })
      ) {
        throw new PublicError('DEPLOYMENT_AGENT_UPDATE_REQUIRED')
      }

      if (
        !context.project.githubInstallationId ||
        !context.project.githubRepoId
      ) {
        throw new PublicError('DEPLOYMENT_GITHUB_INSTALLATION_REQUIRED')
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
        throw new PublicError('DEPLOYMENT_COMMIT_UNAVAILABLE')
      }

      const deployment = await createDeploymentForEnvironment({
        workspaceAdmission,
        deploymentId: admission?.resourceId,
        admission,
        environmentId: environmentConfig.id,
        gitBranch,
        gitSha: commit.sha,
        trigger: admission ? 'api' : 'user',
        commitMeta: toDeploymentCommitMeta(commit),
        createdByUserId: userId,
      })

      return {
        deploymentId: deployment.deploymentId,
      }
    },
    { kind: 'user', userId },
  )
}

export async function createRollbackDeployment({
  deploymentId,
  userId,
  teamSlug,
  projectName,
  admission,
}: {
  deploymentId: string
  userId: string
  teamSlug: string
  projectName: string
  admission?: ApiMutationAdmission
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  return withWorkspaceAccess(
    context.team.id,
    'deployment.create',
    async (workspaceAdmission) => {
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
        throw new PublicError('DEPLOYMENT_NOT_FOUND')
      }

      if (source.status !== 'succeeded') {
        throw new PublicError('DEPLOYMENT_ROLLBACK_UNSUCCESSFUL')
      }

      const deploymentConfig = parseDeploymentConfig(source.config)

      if (!deploymentConfig) {
        throw new PublicError('DEPLOYMENT_CONFIG_INVALID')
      }

      const serverRows = await db
        .select()
        .from(servers)
        .where(eq(servers.id, source.serverId))
        .limit(1)
      const deploymentServer = serverRows.at(0)

      if (!deploymentServer) {
        throw new PublicError('DEPLOYMENT_SERVER_NOT_FOUND')
      }

      const serverStatus = getEffectiveServerStatus({
        status: deploymentServer.status,
        lastSeenAt: deploymentServer.lastSeenAt,
      })

      if (serverStatus !== 'connected') {
        throw new PublicError('DEPLOYMENT_ROLLBACK_SERVER_OFFLINE')
      }

      if (
        !canAgentRunDeployments({
          protocolVersion: deploymentServer.agentProtocolVersion,
          capabilities: deploymentServer.agentCapabilities,
        })
      ) {
        throw new PublicError('DEPLOYMENT_ROLLBACK_AGENT_UPDATE_REQUIRED')
      }

      const rollbackDeploymentId = admission?.resourceId ?? crypto.randomUUID()
      const rollbackHost = await resolveGeneratedHostname({
        kind: 'deployment',
        serverId: deploymentServer.id,
        deploymentId: rollbackDeploymentId,
        projectName: context.project.name,
        serverPublicAddress: deploymentServer.publicAddress,
      })
      const rollbackAliasHostname = rollbackHost.hostname
      const rollbackConfig = await replayDeploymentConfig({
        projectId: context.project.id,
        environmentId: source.environmentId,
        serverId: deploymentServer.id,
        source: deploymentConfig,
        gitBranch: source.gitBranch,
        hostname: rollbackAliasHostname,
        https: rollbackHost.https,
      })
      const now = new Date()
      const commitMeta = normalizeDeploymentCommitMeta(source.commitMeta)
      const created = await enqueueDeployment(db, {
        workspaceAdmission,
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
        https: rollbackHost.https,
        canceledMessage: 'Canceled because a rollback deployment was queued.',
        now,
        admission,
      })

      if (!created) throw new PublicError('DEPLOYMENT_ENVIRONMENT_INACTIVE')
      await notifyProject(context.project.id)

      return {
        deploymentId: rollbackDeploymentId,
      }
    },
    { kind: 'user', userId },
  )
}

export async function createRedeployDeployment({
  deploymentId,
  userId,
  teamSlug,
  projectName,
  admission,
}: {
  deploymentId: string
  userId: string
  teamSlug: string
  projectName: string
  admission?: ApiMutationAdmission
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  return withWorkspaceAccess(
    context.team.id,
    'deployment.create',
    async (workspaceAdmission) => {
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
        throw new PublicError('DEPLOYMENT_NOT_FOUND')
      }

      if (source.status === 'queued' || source.status === 'running') {
        throw new PublicError('DEPLOYMENT_REDEPLOY_ACTIVE')
      }

      const deploymentConfig = parseDeploymentConfig(source.config)

      if (!deploymentConfig) {
        throw new PublicError('DEPLOYMENT_CONFIG_INVALID')
      }

      const serverRows = await db
        .select()
        .from(servers)
        .where(eq(servers.id, source.serverId))
        .limit(1)
      const deploymentServer = serverRows.at(0)

      if (!deploymentServer) {
        throw new PublicError('DEPLOYMENT_SERVER_NOT_FOUND')
      }

      const serverStatus = getEffectiveServerStatus({
        status: deploymentServer.status,
        lastSeenAt: deploymentServer.lastSeenAt,
      })

      if (serverStatus !== 'connected') {
        throw new PublicError('DEPLOYMENT_REDEPLOY_SERVER_OFFLINE')
      }

      if (
        !canAgentRunDeployments({
          protocolVersion: deploymentServer.agentProtocolVersion,
          capabilities: deploymentServer.agentCapabilities,
        })
      ) {
        throw new PublicError('DEPLOYMENT_REDEPLOY_AGENT_UPDATE_REQUIRED')
      }

      const redeploymentId = admission?.resourceId ?? crypto.randomUUID()
      const redeploymentHost = await resolveGeneratedHostname({
        kind: 'deployment',
        serverId: deploymentServer.id,
        deploymentId: redeploymentId,
        projectName: context.project.name,
        serverPublicAddress: deploymentServer.publicAddress,
      })
      const redeploymentAliasHostname = redeploymentHost.hostname
      const redeploymentConfig = await replayDeploymentConfig({
        projectId: context.project.id,
        environmentId: source.environmentId,
        serverId: deploymentServer.id,
        source: deploymentConfig,
        gitBranch: source.gitBranch,
        hostname: redeploymentAliasHostname,
        https: redeploymentHost.https,
      })
      const now = new Date()
      const commitMeta = normalizeDeploymentCommitMeta(source.commitMeta)
      const created = await enqueueDeployment(db, {
        workspaceAdmission,
        deployment: {
          id: redeploymentId,
          environmentId: source.environmentId,
          serverId: deploymentServer.id,
          trigger: admission ? 'api' : 'user',
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
        https: redeploymentHost.https,
        canceledMessage: 'Canceled because a redeployment was queued.',
        now,
        admission,
      })

      if (!created) throw new PublicError('DEPLOYMENT_ENVIRONMENT_INACTIVE')
      await notifyProject(context.project.id)

      return {
        deploymentId: redeploymentId,
      }
    },
    { kind: 'user', userId },
  )
}

export async function getManualDeploymentOptions({
  environmentId,
  branch,
  userId,
  teamSlug,
  projectName,
}: {
  branch?: string
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
    throw new PublicError('DEPLOYMENT_ENVIRONMENT_NOT_FOUND')
  }

  if (!context.project.githubInstallationId || !context.project.githubRepoId) {
    throw new PublicError('DEPLOYMENT_GITHUB_INSTALLATION_REQUIRED')
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
  if (branch && !matchingBranches.includes(branch)) {
    throw new PublicError('DEPLOYMENT_BRANCH_MISMATCH')
  }
  const selectedBranch = branch ?? matchingBranches[0] ?? null
  const commits = selectedBranch
    ? (
        await listBranchCommits({
          accessToken: installationToken.token,
          branch: selectedBranch,
          repo: context.project.githubRepo,
          perPage: 5,
        })
      ).map((commit) => ({ ...commit, branch: selectedBranch }))
    : []

  return {
    environment: {
      id: environment.id,
      name: environment.name,
      branch: environment.branch,
      color: environment.color,
    },
    branches: matchingBranches,
    selectedBranch,
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
  authorName = null,
  authoredAt = null,
  commitUrl = null,
  githubSenderId,
}: {
  deliveryId: string
  installationId: number
  repositoryId: number
  repositoryFullName: string
  branch: string
  gitSha: string
  message: string | null
  authorName?: string | null
  authoredAt?: string | null
  commitUrl?: string | null
  githubSenderId?: string
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
        eq(projects.status, 'active'),
        eq(environments.status, 'active'),
      ),
    )
    .orderBy(asc(projects.id), asc(environments.position))
  // Repository IDs survive renames; only a signed delivery for the same
  // installation may refresh the mutable full name.
  if (candidateRows.length > 0) {
    await db
      .update(projects)
      .set({ githubRepo: repositoryFullName, updatedAt: new Date() })
      .where(
        and(
          eq(projects.githubInstallationId, installationId),
          eq(projects.githubRepoId, repositoryId),
          eq(projects.status, 'active'),
          sql`${projects.githubRepo} <> ${repositoryFullName}`,
        ),
      )
  }
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

  let unrecordedFailure = false
  for (const row of rows) {
    try {
      const serverStatus = row.server
        ? getEffectiveServerStatus({
            status: row.server.status,
            lastSeenAt: row.server.lastSeenAt,
          })
        : null

      if (!row.server || row.server.status === 'deleted') {
        skipped.push({
          projectId: row.project.id,
          environmentId: row.environment.id,
          reason: 'server_disconnected',
        })
        continue
      }
      const skipReason =
        serverStatus !== 'connected'
          ? 'server_disconnected'
          : !canAgentRunDeployments({
                protocolVersion: row.server.agentProtocolVersion,
                capabilities: row.server.agentCapabilities,
              })
            ? 'agent_update_required'
            : null
      const failureMessage =
        skipReason === 'server_disconnected'
          ? 'GitHub push could not deploy because the assigned server is disconnected.'
          : skipReason === 'agent_update_required'
            ? 'GitHub push could not deploy because the assigned agent requires an update.'
            : undefined

      const deployment = await createDeploymentForEnvironment({
        githubDeliveryId: deliveryId,
        environmentId: row.environment.id,
        gitBranch: branch,
        gitSha,
        trigger: 'webhook',
        commitMeta: {
          message,
          authorName,
          authoredAt,
          url: commitUrl,
          ...(githubSenderId ? { githubSenderId } : {}),
        },
        failureMessage,
      })

      if (deployment.status === 'created' && skipReason) {
        skipped.push({
          projectId: row.project.id,
          environmentId: row.environment.id,
          reason: skipReason,
        })
      } else if (deployment.status === 'created') {
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
    } catch (error) {
      // A bad environment must not discard this delivery for unrelated projects.
      // Record a failed attempt without requiring hostname/certificate readiness.
      const failureMessage = getPublicErrorMessage(
        error,
        'GitHub push could not deploy. Review workspace settings and assigned server readiness.',
      )
      try {
        await createDeploymentForEnvironment({
          githubDeliveryId: deliveryId,
          environmentId: row.environment.id,
          gitBranch: branch,
          gitSha,
          trigger: 'webhook',
          commitMeta: {
            message,
            authorName,
            authoredAt,
            url: commitUrl,
            ...(githubSenderId ? { githubSenderId } : {}),
          },
          failureMessage,
        })
      } catch (recordError) {
        unrecordedFailure = true
        console.error(
          'Unable to record failed push deployment',
          safeErrorDiagnostics(recordError),
        )
      }
      console.error(
        'Push deployment admission failed',
        safeErrorDiagnostics(error),
      )
      skipped.push({
        projectId: row.project.id,
        environmentId: row.environment.id,
        reason: 'deployment_failed',
      })
    }
  }

  if (unrecordedFailure) throw new PublicError('INTERNAL_ERROR')

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
  createdByUserId,
  githubDeliveryId,
  failureMessage,
  admission,
  workspaceAdmission: existingAdmission,
}: {
  deploymentId?: string
  environmentId: string
  gitBranch: string
  gitSha: string
  trigger: 'user' | 'webhook' | 'api' | 'rollback'
  commitMeta: DeploymentCommitMeta
  createdByUserId?: string
  githubDeliveryId?: string
  failureMessage?: string
  admission?: ApiMutationAdmission
  workspaceAdmission?: WorkspaceAdmission
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
    throw new PublicError('DEPLOYMENT_ENVIRONMENT_NOT_FOUND')
  }
  const apply = async (
    workspaceAdmission?: WorkspaceAdmission,
  ): Promise<{ status: 'created' | 'existing'; deploymentId: string }> => {
    if (!environmentRow.server) {
      throw new PublicError('DEPLOYMENT_SERVER_REQUIRED')
    }
    if (!environmentRow.project.githubRepoId) {
      throw new PublicError('PROJECT_REPOSITORY_MISSING')
    }
    const server = environmentRow.server
    const repoId = environmentRow.project.githubRepoId

    if (server.status === 'deleted') {
      throw new PublicError('DEPLOYMENT_SERVER_DELETED')
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
    const generatedBranchHost = failureMessage
      ? { hostname: '', https: false }
      : await resolveGeneratedHostname({
          kind: 'branch',
          serverId: server.id,
          branch: gitBranch,
          projectName: environmentRow.project.name,
          serverPublicAddress: server.publicAddress,
        })
    const requestedBranchAliasHostname =
      branchAlias?.hostname ?? generatedBranchHost.hostname
    const branchAliasHostname = failureMessage
      ? ''
      : await resolveAvailableAliasHostname({
          excludeAliasId: branchAlias?.id,
          hostname: requestedBranchAliasHostname,
          uniquenessKey: `${environmentRow.project.id}:${gitBranch}`,
        })
    const generatedDeploymentHost = failureMessage
      ? { hostname: '', https: false }
      : await resolveGeneratedHostname({
          kind: 'deployment',
          serverId: server.id,
          deploymentId,
          projectName: environmentRow.project.name,
          serverPublicAddress: server.publicAddress,
        })
    const requestedDeploymentAliasHostname = generatedDeploymentHost.hostname
    const deploymentAliasHostname = failureMessage
      ? ''
      : await resolveAvailableAliasHostname({
          hostname: requestedDeploymentAliasHostname,
          uniquenessKey: deploymentId,
        })
    const deploymentConfig = createDeploymentConfig({
      environment: environmentRow.environment,
      aliasRows,
      domainRows,
      gitBranch,
      extraHostnames: failureMessage
        ? []
        : [
            {
              hostname: branchAliasHostname,
              environmentId,
              basePath: null,
              https: generatedBranchHost.https,
            },
            {
              hostname: deploymentAliasHostname,
              environmentId,
              basePath: null,
              https: generatedDeploymentHost.https,
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
      workspaceAdmission,
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
        commitMeta: normalizeDeploymentCommitMeta(commitMeta),
        config: deploymentConfig,
        envVars,
        runtimeId: environmentRow.environment.runtimeId,
        createdByUserId,
      },
      projectId: environmentRow.project.id,
      hostname: deploymentAliasHostname,
      branchHostname: branchAlias ? undefined : branchAliasHostname,
      https: generatedDeploymentHost.https,
      failureMessage,
      canceledMessage: `Canceled because a newer ${trigger} deployment was queued.`,
      now,
      admission,
    })

    if (created) await notifyProject(environmentRow.project.id)
    return { status: created ? 'created' : 'existing', deploymentId }
  }
  if (failureMessage) return apply()
  if (existingAdmission) {
    requireWorkspaceAdmission(
      existingAdmission,
      environmentRow.project.teamId,
      'deployment.create',
    )
    return apply(existingAdmission)
  }
  return withWorkspaceAccess(
    environmentRow.project.teamId,
    'deployment.create',
    apply,
    createdByUserId
      ? { kind: 'user', userId: createdByUserId }
      : { kind: 'system', source: 'github.push' },
  )
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

async function replayDeploymentConfig({
  projectId,
  environmentId,
  serverId,
  source,
  gitBranch,
  hostname,
  https,
}: {
  projectId: string
  environmentId: string
  serverId: string
  source: DeploymentConfig
  gitBranch: string
  hostname: string
  https: boolean
}): Promise<DeploymentConfig> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project || project.status !== 'active')
    throw new PublicError('PROJECT_NOT_FOUND')
  const [environment] = await db
    .select()
    .from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1)
  if (!environment || environment.status !== 'active')
    throw new PublicError('DEPLOYMENT_ENVIRONMENT_INACTIVE')
  if ((environment.serverId ?? project.defaultServerId) !== serverId)
    throw new PublicError('DEPLOYMENT_SERVER_CHANGED')
  const [aliasRows, domainRows] = await Promise.all([
    db.select().from(aliases).where(eq(aliases.projectId, project.id)),
    db.select().from(domains).where(eq(domains.projectId, project.id)),
  ])
  const { routes } = resolveDeploymentPublicRoutes({
    project,
    environment,
    aliasRows,
    domainRows,
    gitBranch,
    extraHostnames: [{ hostname, https, environmentId, basePath: null }],
  })
  return { ...source, routes }
}
