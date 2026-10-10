import {
  EnvironmentStateChanged,
  replaceProjectEnvironments,
} from './environment-state'
import { eq } from 'drizzle-orm'

import { db } from '@/server/db'
import { aliases, environments, projects } from '@/server/db/schema'
import { getProjectContext } from './context'
import { buildRuntimeId } from './deployment-config'
import {
  buildDefaultHostForEnvironment,
  generatedAliasUsesHttps,
  resolveAvailableAliasHostname,
} from './hostnames'
import { findDuplicate } from './mappers'
import { encryptProjectEnvVars } from './project-env-vars'
import type {
  ProjectContext,
  ProjectEnvironmentConfig,
  ProjectEnvironmentVariable,
} from './types'

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
  projectEnvironments: Array<
    Omit<ProjectEnvironmentConfig, 'serverId' | 'effectiveServerId'> & {
      serverId?: string | null
      effectiveServerId?: string | null
    }
  >
  defaultServerId?: string | null
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })

  return updateProjectEnvironmentsWithContext({
    context,
    userId,
    teamSlug,
    projectName,
    projectEnvironments,
    defaultServerId,
  })
}

async function updateProjectEnvironmentsWithContext({
  context,
  userId,
  teamSlug,
  projectName,
  projectEnvironments,
  defaultServerId,
  attempt = 0,
}: {
  attempt?: number
  context: ProjectContext
  userId: string
  teamSlug: string
  projectName: string
  projectEnvironments: Array<
    Omit<ProjectEnvironmentConfig, 'serverId' | 'effectiveServerId'> & {
      serverId?: string | null
      effectiveServerId?: string | null
    }
  >
  defaultServerId?: string | null
}) {
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

  const [environmentRows, aliasRows] = await Promise.all([
    db
      .select()
      .from(environments)
      .where(eq(environments.projectId, context.project.id)),
    db.select().from(aliases).where(eq(aliases.projectId, context.project.id)),
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

    return {
      ...environment,
      id: existing?.id ?? environment.id,
      // Definition-only saves omit assignments; resolve them from current rows.
      serverId:
        environment.serverId === undefined
          ? (existing?.serverId ?? null)
          : environment.serverId,
    }
  })
  const reconciledProduction =
    reconciledEnvironments.find(
      (environment) => environment.slug === 'production',
    ) ?? reconciledEnvironments[0]
  if (!reconciledProduction)
    throw new Error('Project requires an active environment.')
  const replacements = []

  for (const [position, environment] of reconciledEnvironments.entries()) {
    const existing = environmentById.get(environment.id)
    const existingAlias = aliasRows.find(
      (alias) =>
        alias.type === 'environment' && alias.environmentId === environment.id,
    )
    const effectiveServerId = environment.serverId ?? effectiveDefaultServerId
    const server = effectiveServerId
      ? context.servers.find((candidate) => candidate.id === effectiveServerId)
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

    replacements.push({
      id: environment.id,
      name: environment.name,
      slug: environment.slug,
      branch: environment.branch,
      serverId: environment.serverId,
      color: environment.color,
      position,
      isProduction: environment.id === reconciledProduction.id,
      runtimeId:
        existing?.runtimeId ??
        buildRuntimeId({
          projectId: context.project.id,
          environmentId: environment.id,
        }),
      alias: hostname
        ? {
            id: existingAlias?.id ?? crypto.randomUUID(),
            hostname,
            https: generatedAliasUsesHttps(server?.publicAddress ?? null),
          }
        : null,
    })
  }

  try {
    await replaceProjectEnvironments(db, {
      projectId: context.project.id,
      previousDefaultServerId: context.project.defaultServerId,
      defaultServerId,
      previousEnvironments: environmentRows,
      previousAliases: aliasRows,
      environments: replacements,
      now,
    })
  } catch (error) {
    if (error instanceof EnvironmentStateChanged && attempt < 2) {
      return updateProjectEnvironmentsWithContext({
        context: await getProjectContext({
          userId,
          teamSlug,
          projectName,
          scope: 'shell',
        }),
        userId,
        teamSlug,
        projectName,
        projectEnvironments,
        defaultServerId,
        attempt: attempt + 1,
      })
    }
    throw error
  }

  return getProjectContext({ userId, teamSlug, projectName, scope: 'settings' })
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
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
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

  return updateProjectEnvironmentsWithContext({
    context,
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
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  const normalizedEnvVars = envVars.filter((item) => item.key.trim() !== '')
  const duplicateKey = findDuplicate(
    normalizedEnvVars.map((item) => `${item.environment ?? ''}:${item.key}`),
  )

  if (duplicateKey) {
    throw new Error('Environment variable keys must be unique per environment.')
  }

  if (
    normalizedEnvVars.some(
      (item) =>
        item.environment &&
        !context.environments.some(
          (environment) => environment.id === item.environment,
        ),
    )
  ) {
    throw new Error('Select a valid environment for every variable.')
  }

  await db
    .update(projects)
    .set({
      envVarsEncrypted: encryptProjectEnvVars(normalizedEnvVars),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, context.project.id))

  return getProjectContext({ userId, teamSlug, projectName, scope: 'settings' })
}
