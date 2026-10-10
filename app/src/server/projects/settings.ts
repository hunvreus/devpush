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
import { removePublicFile, resolveAvatarUpdate } from '@/server/uploads/avatar'
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
import { requireProjectRuntimeConfig } from './runtime-config'
import type { ProjectRuntimeConfig } from './runtime-config'
import type { ProjectRoute } from './types'

export async function updateProjectSettings({
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
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName: currentProjectName,
    scope: 'shell',
  })
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
    throw new Error(
      'Only team owners and admins can change host lifecycle commands.',
    )
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
    throw new Error(
      'Only team owners and admins can change the source of host lifecycle commands.',
    )
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
    await db
      .update(projects)
      .set({
        slug: nextProjectSlug,
        name: nextProjectSlug,
        githubRepoId: repoUpdate.repoId,
        githubRepo: repoUpdate.repoFullName,
        githubInstallationId: repoUpdate.installationId,
        avatarPath,
        runtimeConfig: nextRuntimeConfig,
        composeMetadata,
        updatedAt: now,
      })
      .where(eq(projects.id, context.project.id))
  } catch (error) {
    if (avatarPath && avatarPath !== context.project.avatarUrl) {
      await removePublicFile(avatarPath)
    }

    if (isUniqueConstraintError(error)) {
      throw new Error('Project names must be unique within a team.')
    }
    throw error
  }

  return getProjectContext({
    userId,
    teamSlug,
    projectName: nextProjectSlug,
    scope: 'settings',
  })
}

function hostLifecycleCommandsChanged(
  current: ProjectRuntimeConfig,
  next: ProjectRuntimeConfig,
) {
  return (
    current.deployCommand !== next.deployCommand ||
    current.rollbackCommand !== next.rollbackCommand
  )
}

function hostLifecycleCommandsUseChangedSource({
  currentRepoFullName,
  currentRuntimeConfig,
  nextRepoFullName,
  nextRuntimeConfig,
}: {
  currentRepoFullName: string
  currentRuntimeConfig: ProjectRuntimeConfig
  nextRepoFullName: string
  nextRuntimeConfig: ProjectRuntimeConfig
}) {
  const hasHostCommand = Boolean(
    nextRuntimeConfig.deployCommand || nextRuntimeConfig.rollbackCommand,
  )

  return (
    hasHostCommand &&
    (nextRepoFullName !== currentRepoFullName ||
      nextRuntimeConfig.path !== currentRuntimeConfig.path)
  )
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
    throw new Error('Only team owners and admins can delete projects.')
  }

  if (confirmationName !== context.project.name) {
    throw new Error('Type the project name to confirm deletion.')
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
    throw new Error('Project not found or access changed.')
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
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  const normalizedRoutes = normalizeProjectRoutes(routes)
  const environmentIds = new Set(
    context.environments.map((environment) => environment.id),
  )
  const invalidScopedRoute = normalizedRoutes.find(
    (route) => route.environmentId && !environmentIds.has(route.environmentId),
  )

  if (invalidScopedRoute) {
    throw new Error('Select a valid environment for every scoped route.')
  }
  const duplicateRoute = findDuplicate(
    normalizedRoutes.map(
      (route) => `${route.environmentId ?? 'default'}:${route.path}`,
    ),
  )

  if (duplicateRoute) {
    throw new Error('Each route path can only be configured once per scope.')
  }
  const now = new Date()

  await replaceProjectRoutes(db, {
    projectId: context.project.id,
    routes: normalizedRoutes,
    now,
  })

  return getProjectContext({ userId, teamSlug, projectName, scope: 'settings' })
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
  domains: Array<{
    host: string
    environmentId: string
    basePath: string | null
    https: boolean
  }>
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
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
    throw new Error('Select a valid environment for every domain.')
  }
  const duplicateHost = findDuplicate(
    normalizedDomains.map((domain) => domain.host),
  )

  if (duplicateHost) {
    throw new Error('Each domain can only be added once.')
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
    throw new Error('A custom domain cannot replace a generated alias.')
  try {
    await replaceProjectDomains(db, {
      projectId: context.project.id,
      domains: normalizedDomains,
      now,
    })
  } catch (error) {
    if ((await checkAliases()).length > 0)
      throw new Error('A custom domain cannot replace a generated alias.')
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
    throw new Error('Domain not found.')
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
  resolveAddresses = isIP(expectedAddress) === 6 ? resolve6 : resolve4,
}: {
  hostname: string
  expectedAddress: string
  resolveAddresses?: (hostname: string) => Promise<Array<string>>
}) {
  try {
    const addresses = await resolveAddresses(hostname)

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
