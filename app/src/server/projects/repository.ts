import { withWorkspaceAccess } from '#devpush/server/plugins/workspace-access'
import { resolveGeneratedHostname } from './generated-hostname'
import { PublicError } from '#devpush/lib/public-error'
import type { ApiMutationAdmission } from '#devpush/server/api/admission'
import { insertProject } from './creation-state'
import { isUniqueConstraintError } from '#devpush/server/db/errors'
import { and, eq } from 'drizzle-orm'

import { db } from '#devpush/server/db'
import { servers } from '#devpush/server/db/schema'
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
} from '#devpush/server/github/service'
import { requireTeam } from '#devpush/server/teams/service'
import { buildRuntimeId } from '#devpush/lib/runtime-id'
import { resolveAvailableAliasHostname } from './hostnames'
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
} from '#devpush/lib/project-runtime-config'
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
    throw new PublicError('PROJECT_GITHUB_ACCOUNT_REQUIRED')
  }

  const installations = await listUserInstallations(githubAccount.accessToken)
  const installation = installations.find((item) => item.id === installationId)

  if (!installation) {
    throw new PublicError('PROJECT_GITHUB_ACCOUNT_INSTALLATION_REQUIRED')
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
  admission,
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
  admission?: ApiMutationAdmission
}): Promise<CreatedProject> {
  const normalizedRequestedComposePath = requestedComposePath?.trim() || null
  requireProjectRuntimeConfig(
    createComposeRuntimeConfig({ path: normalizedRequestedComposePath }),
  )

  const team = await requireTeam(userId, teamSlug)
  return withWorkspaceAccess(
    team.id,
    'project.create',
    async () => {
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
        throw new PublicError('PROJECT_SERVER_INVALID')
      }

      if (!githubAccount) {
        throw new PublicError('PROJECT_CREATION_GITHUB_REQUIRED')
      }

      const installations = await listUserInstallations(
        githubAccount.accessToken,
      )
      const installation = installations.find(
        (item) => item.id === installationId,
      )

      if (!installation) {
        throw new PublicError('PROJECT_REPOSITORY_INSTALLATION_REQUIRED')
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
        throw new PublicError('PROJECT_REPOSITORY_INSTALLATION_REQUIRED')
      }

      if (!repo.permissions.push) {
        throw new PublicError('PROJECT_CREATION_PUSH_ACCESS_REQUIRED')
      }

      const projectComposePath =
        normalizedRequestedComposePath ??
        (await detectComposePath({
          accessToken: githubAccount.accessToken,
          repo: repo.fullName,
          ref: repo.defaultBranch,
        }))
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

      const projectId = admission?.resourceId ?? crypto.randomUUID()
      const productionEnvironmentId = crypto.randomUUID()
      const scopedProjectEnvVars = projectEnvVars.map((envVar) => ({
        ...envVar,
        environment:
          envVar.environment === 'production'
            ? productionEnvironmentId
            : envVar.environment,
      }))
      await requireAvailableProjectMachineName(db, team.id, slug)
      const generatedHost = server
        ? await resolveGeneratedHostname({
            kind: 'project',
            serverId: server.id,
            projectName: slug,
            serverPublicAddress: server.publicAddress,
          })
        : null
      const requestedDefaultHost = generatedHost?.hostname ?? null
      const defaultHost = requestedDefaultHost
        ? await resolveAvailableAliasHostname({
            hostname: requestedDefaultHost,
            uniquenessKey: projectId,
          })
        : null

      try {
        const inserted = await insertProject(db, {
          userId,
          admission,
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
          https: generatedHost?.https ?? false,
        })
        if (!inserted) throw new PublicError('PROJECT_ACCESS_CHANGED')
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
    },
    { kind: 'user', userId },
  )
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
