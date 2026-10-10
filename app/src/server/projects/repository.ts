import { insertProject } from './creation-state'
import { isUniqueConstraintError } from '@/server/db/errors'
import { and, eq } from 'drizzle-orm'

import { db } from '@/server/db'
import { servers } from '@/server/db/schema'
import {
  createInstallationAccessToken,
  detectComposePath,
  getGitHubAccount,
  getGitHubRepository,
  getGitHubAppInstallUrl,
  getRepositoryFileText,
  isGitHubAppConfigured,
  listInstallationRepositories,
  listUserInstallations,
  upsertGitHubInstallation,
} from '@/server/github/service'
import { requireTeam } from '@/server/teams/service'
import { buildRuntimeId } from './deployment-config'
import {
  buildDefaultHostForProject,
  generatedAliasUsesHttps,
  resolveAvailableAliasHostname,
} from './hostnames'
import {
  requireAvailableProjectMachineName,
  validateProjectMachineName,
} from './names'
import { parseComposeMetadata } from './compose-metadata'
import type { ProjectComposeMetadata } from './compose-metadata'
import { encryptProjectEnvVars } from './project-env-vars'
import {
  createComposeRuntimeConfig,
  requireProjectRuntimeConfig,
} from './runtime-config'
import type {
  CreatedProject,
  ProjectEnvironmentVariable,
  ProjectRoute,
  RepositorySelectionContext,
} from './types'

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
  readinessPath,
  releaseCommand,
  releaseService,
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
  readinessPath?: string
  releaseCommand?: string
  releaseService?: string
}): Promise<CreatedProject> {
  const normalizedRequestedComposePath = requestedComposePath?.trim() || null
  requireProjectRuntimeConfig(
    createComposeRuntimeConfig({ path: normalizedRequestedComposePath }),
  )

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

  const projectComposePath = composePath ?? normalizedRequestedComposePath
  let initialRoutes: Array<ProjectRoute> = []
  let initialComposeMetadata: ProjectComposeMetadata | null = null
  if (projectComposePath) {
    try {
      const composeText = await getRepositoryFileText({
        accessToken: githubAccount.accessToken,
        repo: repo.fullName,
        path: projectComposePath,
        ref: repo.defaultBranch,
      })
      initialComposeMetadata = parseComposeMetadata(composeText)
      const suggestedRoute = initialComposeMetadata.suggestedRoute
      initialRoutes = suggestedRoute ? [suggestedRoute] : []
    } catch {
      initialComposeMetadata = null
      initialRoutes = []
    }
  }
  const projectEnvVars = envVars ?? []
  const slug = projectName.trim()
  validateProjectMachineName(slug)

  const projectId = crypto.randomUUID()
  const productionEnvironmentId = crypto.randomUUID()
  const scopedProjectEnvVars = projectEnvVars.map((envVar) => ({
    ...envVar,
    environment:
      envVar.environment === 'production'
        ? productionEnvironmentId
        : envVar.environment,
  }))
  await requireAvailableProjectMachineName(db, team.id, slug)
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

  try {
    await insertProject(db, {
      project: {
        id: projectId,
        teamId: team.id,
        slug,
        name: slug,
        githubRepoId: repo.id,
        githubRepo: repo.fullName,
        githubInstallationId: installationId,
        defaultServerId: server?.id ?? null,
        routes: initialRoutes,
        envVarsEncrypted: encryptProjectEnvVars(scopedProjectEnvVars),
        runtimeConfig: requireProjectRuntimeConfig(
          createComposeRuntimeConfig({
            path: projectComposePath,
            readinessPath: readinessPath?.trim() || null,
            releaseCommand: releaseCommand?.trim() || null,
            releaseService:
              releaseCommand?.trim() && releaseService?.trim()
                ? releaseService.trim()
                : null,
          }),
        ),
        composeMetadata: initialComposeMetadata,
      },
      environment: {
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
        runtimeId: buildRuntimeId({
          projectId,
          environmentId: productionEnvironmentId,
        }),
      },
      hostname: defaultHost,
      https: generatedAliasUsesHttps(server?.publicAddress ?? null),
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // A concurrent creation can win after the friendly preflight check.
      await requireAvailableProjectMachineName(db, team.id, slug)
    }
    throw error
  }

  return {
    id: projectId,
    name: slug,
    githubRepo: repo.fullName,
    composePath: projectComposePath,
  }
}

export async function fetchProjectComposeMetadata({
  installationId,
  repositoryId,
  repositoryFullName,
  path,
  ref,
}: {
  installationId: number | null
  repositoryId: number | null
  repositoryFullName: string
  path: string | null
  ref: string
}): Promise<ProjectComposeMetadata | null> {
  if (!path || !installationId || !repositoryFullName) {
    return null
  }

  try {
    const installation = await createInstallationAccessToken({
      installationId,
      repositoryId,
      repositoryFullName,
    })
    const composeText = await getRepositoryFileText({
      accessToken: installation.token,
      repo: repositoryFullName,
      path,
      ref,
    })

    return parseComposeMetadata(composeText)
  } catch {
    return null
  }
}
