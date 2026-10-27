import { withWorkspaceAccess } from '#devpush/server/plugins/workspace-access'
import { resolveGeneratedHostname } from './generated-hostname'
import { getProjectSettingsContext } from './settings-context'
import type { ApiMutationAdmission } from '#devpush/server/api/admission'
import { PublicError } from '#devpush/lib/public-error'
import {
  EnvironmentStateChanged,
  replaceProjectEnvironments,
} from './environment-state'
import { and, eq, sql } from 'drizzle-orm'
import { projectSettingsGuard } from '#devpush/server/settings-version'

import { db } from '#devpush/server/db'
import { aliases, environments, projects } from '#devpush/server/db/schema'
import { getProjectContext } from './context'
import { buildRuntimeId } from '#devpush/lib/runtime-id'
import { resolveAvailableAliasHostname } from './hostnames'
import { findDuplicate } from './mappers'
import { encryptProjectEnvVars } from './project-env-vars'
import type {
  ProjectContext,
  ProjectEnvironmentConfig,
  ProjectEnvironmentVariable,
} from './types'

export async function updateProjectEnvironments({
  projectId,
  userId,
  teamSlug,
  projectName,
  projectEnvironments,
  defaultServerId,
  admission,
  settingsVersion,

  mutationTime,
}: {
  projectId?: string
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
  admission?: ApiMutationAdmission
  settingsVersion?: number
  mutationTime?: Date
}) {
  const context = await getProjectSettingsContext({
    projectId,
    settingsVersion,
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  return withWorkspaceAccess(
    context.team.id,
    'environment.update',
    async () => {
      return updateProjectEnvironmentsWithContext({
        context,
        userId,
        teamSlug,
        projectName,
        projectEnvironments,
        defaultServerId,
        admission,
        settingsVersion,

        mutationTime,
      })
    },
    { kind: 'user', userId },
  )
}

async function updateProjectEnvironmentsWithContext({
  context,
  userId,
  teamSlug,
  projectName,
  projectEnvironments,
  defaultServerId,
  admission,
  settingsVersion,

  mutationTime,
}: {
  admission?: ApiMutationAdmission
  settingsVersion?: number
  mutationTime?: Date
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
  const expectedVersion = settingsVersion ?? context.project.settingsVersion
  if (expectedVersion !== context.project.settingsVersion)
    throw new PublicError('SETTINGS_CONFLICT')
  const activeEnvironments = projectEnvironments.filter(
    (environment) => environment.status === 'active',
  )
  const production = activeEnvironments.find(
    (environment) => environment.slug === 'production',
  )

  if (!production) {
    throw new PublicError('PROJECT_PRODUCTION_ENVIRONMENT_REQUIRED')
  }

  const duplicateSlug = findDuplicate(
    activeEnvironments.map((environment) => environment.slug),
  )

  if (duplicateSlug) {
    throw new PublicError('PROJECT_ENVIRONMENT_IDENTIFIER_DUPLICATED')
  }

  const now = mutationTime ?? new Date()
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
    throw new PublicError('PROJECT_ACTIVE_ENVIRONMENT_REQUIRED')
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
      throw new PublicError('PROJECT_ENVIRONMENT_SERVER_INVALID')
    }

    const generatedHost = server
      ? await resolveGeneratedHostname({
          kind: 'environment',
          serverId: server.id,
          environmentSlug: environment.slug,
          projectName: context.project.name,
          serverPublicAddress: server.publicAddress,
        })
      : null
    const requestedHostname = generatedHost?.hostname ?? null
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
            https: generatedHost!.https,
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
      admission,
      settingsVersion: expectedVersion,
      userId,
    })
  } catch (error) {
    if (error instanceof EnvironmentStateChanged)
      throw new PublicError('SETTINGS_CONFLICT')
    throw error
  }

  return getProjectContext({ userId, teamSlug, projectName, scope: 'settings' })
}

export async function updateProjectEnvironmentServers({
  projectId,
  userId,
  teamSlug,
  projectName,
  defaultServerId,
  environmentServers,
  admission,
  settingsVersion,

  mutationTime,
}: {
  projectId?: string
  userId: string
  teamSlug: string
  projectName: string
  defaultServerId: string | null
  environmentServers: Array<{ environmentId: string; serverId: string | null }>
  admission?: ApiMutationAdmission
  settingsVersion?: number
  mutationTime?: Date
}) {
  const context = await getProjectSettingsContext({
    projectId,
    settingsVersion,
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  return withWorkspaceAccess(
    context.team.id,
    'environment.update',
    async () => {
      const duplicateEnvironment = findDuplicate(
        environmentServers.map((assignment) => assignment.environmentId),
      )

      if (duplicateEnvironment !== null) {
        throw new PublicError('PROJECT_ENVIRONMENT_SERVER_DUPLICATED')
      }

      if (
        defaultServerId &&
        !context.servers.some((server) => server.id === defaultServerId)
      ) {
        throw new PublicError('PROJECT_DEFAULT_SERVER_INVALID')
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
          throw new PublicError('PROJECT_SERVER_ASSIGNMENT_INVALID')
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
        admission,
        settingsVersion,

        mutationTime,
        projectEnvironments: context.environments.map((environment) => ({
          ...environment,
          serverId: serverByEnvironment.has(environment.id)
            ? (serverByEnvironment.get(environment.id) ?? null)
            : environment.serverId,
        })),
      })
    },
    { kind: 'user', userId },
  )
}

export async function updateProjectEnvVars({
  settingsVersion,
  projectId,
  userId,
  teamSlug,
  projectName,
  envVars,
}: {
  settingsVersion?: number
  projectId?: string
  userId: string
  teamSlug: string
  projectName: string
  envVars: Array<ProjectEnvironmentVariable>
}) {
  const context = await getProjectSettingsContext({
    projectId,
    settingsVersion,
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  return withWorkspaceAccess(
    context.team.id,
    'variable.update',
    async () => {
      const expectedVersion = settingsVersion ?? context.project.settingsVersion
      if (expectedVersion !== context.project.settingsVersion)
        throw new PublicError('SETTINGS_CONFLICT')
      const normalizedEnvVars = envVars.filter((item) => item.key.trim() !== '')
      const duplicateKey = findDuplicate(
        normalizedEnvVars.map(
          (item) => `${item.environment ?? ''}:${item.key}`,
        ),
      )

      if (duplicateKey) {
        throw new PublicError('PROJECT_VARIABLE_DUPLICATED')
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
        throw new PublicError('PROJECT_VARIABLE_ENVIRONMENT_INVALID')
      }

      const changed = await db
        .update(projects)
        .set({
          settingsVersion: sql`${projects.settingsVersion} + 1`,
          envVarsEncrypted: encryptProjectEnvVars(normalizedEnvVars),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projects.id, context.project.id),
            projectSettingsGuard(context.project.id, userId, expectedVersion),
          ),
        )
        .returning({ id: projects.id })
      if (!changed.length) throw new PublicError('SETTINGS_CONFLICT')

      return getProjectContext({
        userId,
        teamSlug,
        projectName,
        scope: 'settings',
      })
    },
    { kind: 'user', userId },
  )
}
