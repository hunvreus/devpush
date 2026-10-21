import { updateProjectRuntimeState } from './configuration-state'
import { getProjectSettingsContext } from './settings-context'
import { PublicError } from '@/lib/public-error'
import { replaceProjectDomains } from './domain-state'
import { replaceProjectRoutes } from './route-state'
import { isUniqueConstraintError } from '@/server/db/errors'
import { and, eq, sql } from 'drizzle-orm'
import { resolve4, resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'

import { canManageTeamSettings } from '@/lib/team-role'
import { deleteProjectState } from './deletion-state'
import { db } from '@/server/db'
import {
  aliases,
  deployments,
  domains,
  environments,
  projects,
  servers,
} from '@/server/db/schema'
import {
  detectComposePath,
  getGitHubAccount,
  getGitHubRepository,
  listInstallationRepositories,
  listUserInstallations,
  upsertGitHubInstallation,
} from '@/server/github/service'
import { canDeleteProject } from '@/server/teams/delete-policy'
import { requireTeam } from '@/server/teams/service'
import { removeOwnedAvatar, resolveAvatarUpdate } from '@/server/uploads/avatar'
import { getProjectContext } from './context'
import {
  findDuplicate,
  getEffectiveProjectRoutes,
  normalizeProjectRoutes,
} from './mappers'
import {
  requireAvailableProjectMachineName,
  validateProjectMachineName,
} from './names'
import { fetchProjectComposeMetadata } from './repository'
import {
  requireProjectRuntimeConfig,
  hostLifecycleCommandsChanged,
  hostLifecycleCommandsUseChangedSource,
} from '@/lib/project-runtime-config'
import type { ProjectRuntimeConfig } from '@/lib/project-runtime-config'
import type { ProjectRoute } from './types'

export async function updateProjectSettings({
  settingsVersion,
  section,
  projectId,
  userId,
  teamSlug,
  currentProjectName,
  projectName,
  repoFullName,
  installationId,
  avatarDataUrl,
  deleteAvatar,
  runtimeConfig,
}: {
  section?: 'general' | 'build'
  settingsVersion?: number
  projectId?: string
  userId: string
  teamSlug: string
  currentProjectName: string
  projectName: string
  repoFullName: string
  installationId: number | null
  avatarDataUrl?: string | null
  deleteAvatar?: boolean
  runtimeConfig: ProjectRuntimeConfig
}) {
  const context = await getProjectSettingsContext({
    projectId,
    settingsVersion,
    userId,
    teamSlug,
    projectName: currentProjectName,
    scope: 'shell',
  })
  const expectedVersion = settingsVersion ?? context.project.settingsVersion
  if (expectedVersion !== context.project.settingsVersion)
    throw new PublicError('SETTINGS_CONFLICT')
  const [snapshot] = await db
    .select({
      updatedAt: projects.updatedAt,
      runtimeConfig: projects.runtimeConfig,
      repository: projects.githubRepo,
      name: projects.name,
    })
    .from(projects)
    .where(eq(projects.id, context.project.id))
    .limit(1)
  if (
    !snapshot ||
    JSON.stringify(requireProjectRuntimeConfig(snapshot.runtimeConfig)) !==
      JSON.stringify(context.project.runtimeConfig) ||
    snapshot.repository !== context.project.githubRepo ||
    snapshot.name !== context.project.name
  )
    throw new PublicError('SETTINGS_CONFLICT')
  const nextProjectSlug = projectName.trim()
  validateProjectMachineName(nextProjectSlug)
  const nextRuntimeConfig = requireProjectRuntimeConfig(runtimeConfig)

  if (
    hostLifecycleCommandsChanged(
      context.project.runtimeConfig,
      nextRuntimeConfig,
    ) &&
    !canManageTeamSettings(context.team.role)
  ) {
    throw new PublicError('PROJECT_HOST_COMMANDS_FORBIDDEN')
  }

  if (
    hostLifecycleCommandsUseChangedSource({
      currentRepoFullName: context.project.githubRepo,
      currentRuntimeConfig: context.project.runtimeConfig,
      nextRepoFullName: repoFullName,
      nextRuntimeConfig,
    }) &&
    !canManageTeamSettings(context.team.role)
  ) {
    throw new PublicError('PROJECT_HOST_COMMAND_SOURCE_FORBIDDEN')
  }

  const repoUpdate = await resolveProjectRepositoryUpdate({
    userId,
    teamSlug,
    currentRepoFullName: context.project.githubRepo,
    currentInstallationId: context.project.githubInstallationId,
    currentRepoId: context.project.githubRepoId,
    repoFullName,
    installationId,
    composePath: nextRuntimeConfig.path ?? '',
  })
  const fetchedComposeMetadata = await fetchProjectComposeMetadata({
    installationId: repoUpdate.installationId,
    repositoryId: repoUpdate.repoId,
    repositoryFullName: repoUpdate.repoFullName,
    path: nextRuntimeConfig.path,
    ref: context.environment.branch,
  })
  const composeSourceUnchanged =
    repoUpdate.repoFullName === context.project.githubRepo &&
    nextRuntimeConfig.path === context.project.runtimeConfig.path
  const composeMetadata = nextRuntimeConfig.path
    ? (fetchedComposeMetadata ??
      (composeSourceUnchanged ? context.composeMetadata : null))
    : null
  const avatarPath = await resolveAvatarUpdate({
    filePrefix: 'project',
    resourceId: context.project.id,
    currentAvatarPath: context.project.avatarUrl,
    avatarDataUrl,
    deleteAvatar: deleteAvatar ?? false,
  })
  const now = new Date()

  try {
    await requireAvailableProjectMachineName(
      db,
      context.team.id,
      nextProjectSlug,
      context.project.id,
    )
    const changedHostCommands =
      hostLifecycleCommandsChanged(
        context.project.runtimeConfig,
        nextRuntimeConfig,
      ) ||
      hostLifecycleCommandsUseChangedSource({
        currentRepoFullName: context.project.githubRepo,
        currentRuntimeConfig: context.project.runtimeConfig,
        nextRepoFullName: repoUpdate.repoFullName,
        nextRuntimeConfig,
      })
    const changed =
      section === 'build'
        ? await updateProjectRuntimeState(db, {
            projectId: context.project.id,
            userId,
            settingsVersion: expectedVersion,
            currentRuntimeConfig: snapshot.runtimeConfig,
            runtimeConfig: nextRuntimeConfig,
            composeMetadata,
            now,
          })
        : (
            await db
              .update(projects)
              .set({
                ...{
                  slug: nextProjectSlug,
                  name: nextProjectSlug,
                  githubRepoId: repoUpdate.repoId,
                  githubRepo: repoUpdate.repoFullName,
                  githubInstallationId: repoUpdate.installationId,
                  avatarPath,
                },
                ...(section !== 'general'
                  ? { runtimeConfig: nextRuntimeConfig }
                  : {}),
                composeMetadata,
                settingsVersion: sql`${projects.settingsVersion} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  eq(projects.id, context.project.id),
                  eq(projects.status, 'active'),
                  eq(projects.settingsVersion, expectedVersion),

                  sql`${projects.runtimeConfig} = ${JSON.stringify(snapshot.runtimeConfig)}`,
                  sql`exists(select 1 from team_members m join user u on u.id = m.user_id join teams t on t.id = m.team_id where m.team_id = ${context.team.id} and m.user_id = ${userId} and u.status = 'active' and t.status = 'active' ${changedHostCommands ? sql`and m.role in ('owner','admin')` : sql``})`,
                ),
              )
              .returning({ id: projects.id })
          ).length === 1
    if (!changed) throw new PublicError('SETTINGS_CONFLICT')
  } catch (error) {
    if (avatarPath && avatarPath !== context.project.avatarUrl) {
      await removeOwnedAvatar(avatarPath, {
        filePrefix: 'project',
        resourceId: context.project.id,
      })
    }

    if (isUniqueConstraintError(error)) {
      throw new PublicError('PROJECT_NAME_CONFLICT')
    }
    throw error
  }

  if (context.project.avatarUrl !== avatarPath) {
    await removeOwnedAvatar(context.project.avatarUrl, {
      filePrefix: 'project',
      resourceId: context.project.id,
    })
  }
  return getProjectContext({
    userId,
    teamSlug,
    projectName: nextProjectSlug,
    scope: 'settings',
  })
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
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })

  if (!canDeleteProject(context.team.role)) {
    throw new PublicError('PROJECT_DELETE_FORBIDDEN')
  }

  if (confirmationName !== context.project.name) {
    throw new PublicError('PROJECT_DELETE_CONFIRMATION')
  }

  const now = new Date()

  if (
    !(await deleteProjectState(db, {
      projectId: context.project.id,
      teamId: context.team.id,
      userId,
      removeDeployments,
      now,
    }))
  )
    throw new PublicError('PROJECT_ACCESS_CHANGED')
}

export async function updateProjectRoutes({
  settingsVersion,
  projectId,
  userId,
  teamSlug,
  projectName,
  routes,
}: {
  settingsVersion?: number
  projectId?: string
  userId: string
  teamSlug: string
  projectName: string
  routes: Array<ProjectRoute>
}) {
  const context = await getProjectSettingsContext({
    projectId,
    settingsVersion,
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  const expectedVersion = settingsVersion ?? context.project.settingsVersion
  if (expectedVersion !== context.project.settingsVersion)
    throw new PublicError('SETTINGS_CONFLICT')
  const normalizedRoutes = normalizeProjectRoutes(routes)
  const environmentIds = new Set(
    context.environments.map((environment) => environment.id),
  )
  const invalidScopedRoute = normalizedRoutes.find(
    (route) => route.environmentId && !environmentIds.has(route.environmentId),
  )

  if (invalidScopedRoute) {
    throw new PublicError('PROJECT_ROUTE_ENVIRONMENT_INVALID')
  }
  const duplicateRoute = findDuplicate(
    normalizedRoutes.map(
      (route) => `${route.environmentId ?? 'default'}:${route.path}`,
    ),
  )

  if (duplicateRoute) {
    throw new PublicError('PROJECT_ROUTE_DUPLICATED')
  }
  const now = new Date()

  await replaceProjectRoutes(db, {
    userId,
    settingsVersion: expectedVersion,
    projectId: context.project.id,
    routes: normalizedRoutes,
    now,
  })

  return getProjectContext({ userId, teamSlug, projectName, scope: 'settings' })
}

export async function updateProjectDomains({
  settingsVersion,
  projectId,
  userId,
  teamSlug,
  projectName,
  domains: projectDomains,
}: {
  settingsVersion?: number
  projectId?: string
  userId: string
  teamSlug: string
  projectName: string
  domains: Array<{
    host: string
    environmentId: string
    basePath: string | null
    https: boolean
  }>
}) {
  const context = await getProjectSettingsContext({
    projectId,
    settingsVersion,
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  const expectedVersion = settingsVersion ?? context.project.settingsVersion
  if (expectedVersion !== context.project.settingsVersion)
    throw new PublicError('SETTINGS_CONFLICT')
  const normalizedDomains = projectDomains.map((domain) => ({
    host: domain.host.trim().toLowerCase(),
    environmentId: domain.environmentId,
    basePath: domain.basePath,
    https: domain.https,
  }))
  const environmentIds = new Set(
    context.environments.map((environment) => environment.id),
  )
  const invalidDomain = normalizedDomains.find(
    (domain) => !environmentIds.has(domain.environmentId),
  )

  if (invalidDomain) {
    throw new PublicError('PROJECT_DOMAIN_ENVIRONMENT_INVALID')
  }
  const duplicateHost = findDuplicate(
    normalizedDomains.map((domain) => domain.host),
  )

  if (duplicateHost) {
    throw new PublicError('PROJECT_DOMAIN_DUPLICATED')
  }

  for (const domain of normalizedDomains) {
    const routePaths = new Set(
      getEffectiveProjectRoutes(context.routes, domain.environmentId).map(
        (route) => route.path,
      ),
    )
    if (domain.basePath && !routePaths.has(domain.basePath)) {
      domain.basePath = null
    }
  }

  const now = new Date()

  const checkAliases = () =>
    db
      .select({ hostname: aliases.hostname })
      .from(aliases)
      .where(
        sql`${aliases.hostname} in (select value from json_each(${JSON.stringify(normalizedDomains.map((item) => item.host))}))`,
      )
  if ((await checkAliases()).length > 0)
    throw new PublicError('PROJECT_GENERATED_ALIAS_PROTECTED')
  try {
    await replaceProjectDomains(db, {
      userId,
      settingsVersion: expectedVersion,
      projectId: context.project.id,
      domains: normalizedDomains,
      now,
    })
  } catch (error) {
    if ((await checkAliases()).length > 0)
      throw new PublicError('PROJECT_GENERATED_ALIAS_PROTECTED')
    throw error
  }

  return getProjectContext({ userId, teamSlug, projectName, scope: 'settings' })
}

export async function verifyProjectDomain({
  userId,
  teamSlug,
  projectName,
  domainId,
}: {
  userId: string
  teamSlug: string
  projectName: string
  domainId: string
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  const rows = await db
    .select({ domain: domains, server: servers })
    .from(domains)
    .innerJoin(environments, eq(environments.id, domains.environmentId))
    .innerJoin(projects, eq(projects.id, domains.projectId))
    .leftJoin(
      servers,
      eq(
        servers.id,
        sql`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
      ),
    )
    .where(
      and(eq(domains.id, domainId), eq(domains.projectId, context.project.id)),
    )
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new PublicError('PROJECT_DOMAIN_NOT_FOUND')
  }

  const succeededDeployment = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.environmentId, row.domain.environmentId),
        eq(deployments.status, 'succeeded'),
      ),
    )
    .limit(1)

  let status: 'active' | 'failed' = 'failed'
  let message: string | null = null

  if (succeededDeployment.length === 0) {
    message =
      'Deploy this environment successfully before verifying its domain.'
  } else if (!row.server?.publicAddress) {
    message = 'The assigned server has no public IP address.'
  } else if (!isIP(row.server.publicAddress)) {
    message = `The assigned server address ${row.server.publicAddress} is not a valid IP address.`
  } else {
    const result = await verifyDomainAddress({
      hostname: row.domain.hostname,
      expectedAddress: row.server.publicAddress,
      additionalAddresses: [
        row.server.publicIpv4,
        row.server.publicIpv6,
      ].filter((value): value is string => Boolean(value)),
    })
    status = result.verified ? 'active' : 'failed'
    message = result.message
  }

  const now = new Date()
  await db
    .update(domains)
    .set({
      status,
      message,
      verifiedAt: status === 'active' ? now : null,
      updatedAt: now,
    })
    .where(eq(domains.id, row.domain.id))

  return {
    context: await getProjectContext({
      userId,
      teamSlug,
      projectName,
      scope: 'settings',
    }),
    message,
    verified: status === 'active',
  }
}

export async function verifyDomainAddress({
  hostname,
  expectedAddress,
  additionalAddresses = [],
  resolveAddresses,
}: {
  hostname: string
  expectedAddress: string
  additionalAddresses?: Array<string>
  resolveAddresses?: (hostname: string) => Promise<Array<string>>
}): Promise<{ verified: boolean; message: string | null }> {
  if (additionalAddresses.length) {
    const results = await Promise.all(
      [...new Set([expectedAddress, ...additionalAddresses])].map((address) =>
        verifyDomainAddress({
          hostname,
          expectedAddress: address,
          resolveAddresses,
        }),
      ),
    )
    return results.find((result) => result.verified) ?? results[0]!
  }
  try {
    const addresses = await (
      resolveAddresses ?? (isIP(expectedAddress) === 6 ? resolve6 : resolve4)
    )(hostname)

    const normalize = (address: string) =>
      isIP(address) === 6 ? new URL(`http://[${address}]`).hostname : address

    return addresses.some(
      (address) => normalize(address) === normalize(expectedAddress),
    )
      ? { verified: true, message: null }
      : {
          verified: false,
          message: `DNS resolves to ${addresses.join(', ') || 'no matching address'}; expected ${expectedAddress}.`,
        }
  } catch (error) {
    return {
      verified: false,
      message:
        error instanceof Error
          ? `DNS lookup failed: ${error.message}`
          : 'DNS lookup failed.',
    }
  }
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
    throw new PublicError('PROJECT_REPOSITORY_INSTALLATION_REQUIRED_SELECTION')
  }

  await requireTeam(userId, teamSlug)
  const githubAccount = await getGitHubAccount(userId)

  if (!githubAccount) {
    throw new PublicError('PROJECT_REPOSITORY_GITHUB_REQUIRED')
  }

  const installations = await listUserInstallations(githubAccount.accessToken)
  const installation = installations.find((item) => item.id === installationId)

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
    throw new PublicError('PROJECT_REPOSITORY_PUSH_ACCESS_REQUIRED')
  }

  const detectedComposePath = await detectComposePath({
    accessToken: githubAccount.accessToken,
    repo: repo.fullName,
    ref: repo.defaultBranch,
  })

  if (!detectedComposePath && composePath.trim() === '') {
    throw new PublicError('PROJECT_COMPOSE_PATH_REQUIRED')
  }

  return {
    repoId: repo.id,
    repoFullName: repo.fullName,
    installationId,
  }
}
