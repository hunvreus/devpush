import { settingsVersionSchema } from '#devpush/lib/settings-version'
import { publicErrorsMiddleware } from '#devpush/server/http/public-errors'
import { backupConfigSchema } from '#devpush/lib/backup-policy-schema'
import { backupRestoreArtifactSchema } from '#devpush/lib/backup-restore-schema'
import { projectEnvironmentsSchema } from '#devpush/lib/project-environments-schema'
import { projectEnvVarsSchema } from '#devpush/lib/project-env-schema'
import {
  projectRoutesSchema,
  projectDomainsSchema,
} from '#devpush/lib/project-routing-schema'
import type { envVarSchema } from '#devpush/lib/project-creation-schema'
import { createProjectSchema } from '#devpush/lib/project-creation-schema'
import {
  projectSettingsSchema,
  projectSettingsErrors,
  projectValidationErrors,
} from '#devpush/lib/project-settings-schema'
import { randomUUID } from 'node:crypto'

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireBackupsEnabled } from '#devpush/server/backups/feature'

import {
  getAuthSession,
  requireAuthSession,
} from '#devpush/server/auth/session.server'
import {
  createManualDeployment,
  createRedeployDeployment,
  createRollbackDeployment,
  getManualDeploymentOptions,
} from '#devpush/server/projects/deployments'
import {
  updateProjectEnvironments,
  updateProjectEnvironmentServers,
  updateProjectEnvVars,
} from '#devpush/server/projects/environments'
import {
  deleteProject,
  updateProjectDomains,
  updateProjectRoutes,
  updateProjectSettings,
  verifyProjectDomain,
} from '#devpush/server/projects/settings'
import {
  createBackupRestoreJob,
  createManualBackupRun,
  saveProjectBackupPolicy,
  deleteProjectBackupPolicy,
} from '#devpush/server/projects/backups'
import {
  getDeploymentLogsContext,
  getDeploymentSectionContext,
  getProjectContext,
  getProjectLogsSectionContext,
  getProjectSectionContext,
} from '#devpush/server/projects/context'
import {
  createProjectFromGitHub,
  getRepositorySelection,
  listRepositorySelectionRepositories,
} from '#devpush/server/projects/repository'

const teamSlugSchema = z.object({
  teamSlug: z.string().min(1),
})

const projectRouteSchema = z.object({
  teamSlug: z.string().min(1),
  projectName: z.string().min(1),
})

const deleteProjectSchema = projectRouteSchema.extend({
  confirmationName: z.string().trim().min(1),
  removeDeployments: z.boolean().default(true),
})

const deployProjectSchema = projectRouteSchema.extend({
  environmentId: z.string().trim().min(1),
  gitBranch: z.string().trim().min(1),
  gitSha: z.string().trim().min(1).optional(),
})

const deployOptionsSchema = projectRouteSchema.extend({
  branch: z.string().min(1).optional(),
  environmentId: z.string().trim().min(1),
})

const deploymentRouteSchema = projectRouteSchema.extend({
  deploymentId: z.string().min(1),
})

const backupRouteSchema = projectRouteSchema.extend({
  backupConfigId: z.string().min(1),
})

const backupRestoreSchema = projectRouteSchema.extend({
  backupRunId: z.string().min(1),
  artifacts: z.array(backupRestoreArtifactSchema).min(1),
})

const projectLogsSchema = projectRouteSchema.extend({
  branch: z.string().trim().optional().nullable(),
  date: z.string().trim().optional().nullable(),
  deploymentId: z.string().trim().optional().nullable(),
  environmentId: z.string().trim().optional().nullable(),
  keyword: z.string().trim().optional().nullable(),
})

const projectEnvironmentServersSchema = projectRouteSchema.extend({
  projectId: z.string().min(1),
  settingsVersion: settingsVersionSchema,
  defaultServerId: z.string().trim().min(1).nullable(),
  environmentServers: z.array(
    z.object({
      environmentId: z.string().trim().min(1),
      serverId: z.string().trim().min(1).nullable(),
    }),
  ),
})

const repositorySelectionRepositoriesSchema = z.object({
  teamSlug: z.string().min(1),
  installationId: z.number().int().positive(),
})

export const getRepositorySelectionContext = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: { teamSlug: string }) => teamSlugSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before selecting a repository.',
    )

    return getRepositorySelection({
      userId: session.user.id,
      teamSlug: data.teamSlug,
    })
  })

export const getRepositorySelectionRepositories = createServerFn({
  method: 'GET',
})
  .middleware([publicErrorsMiddleware])
  .validator((data: { installationId: number; teamSlug: string }) =>
    repositorySelectionRepositoriesSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before selecting a repository.',
    )

    return listRepositorySelectionRepositories({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      installationId: data.installationId,
    })
  })

export const createProject = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      composePath?: string
      envVars?: Array<z.infer<typeof envVarSchema>>
      installationId: number
      projectName: string
      readinessPath?: string
      releaseCommand?: string
      releaseService?: string
      repoFullName: string
      serverId?: string | null
      teamSlug: string
    }) => createProjectSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before creating a project.',
    )

    return createProjectFromGitHub({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      repoFullName: data.repoFullName,
      installationId: data.installationId,
      serverId: data.serverId?.trim() || null,
      composePath: data.composePath ?? '',
      readinessPath: data.readinessPath ?? '',
      releaseCommand: data.releaseCommand ?? '',
      releaseService: data.releaseService ?? '',
      envVars: data.envVars ?? [],
    })
  })

export const getProject = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: { projectName: string; teamSlug: string }) =>
    projectRouteSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    return getProjectContext({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      scope: 'shell',
    })
  })

export const getProjectSection = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      projectName: string
      scope: 'backups' | 'deployments' | 'overview' | 'settings'
      teamSlug: string
    }) =>
      projectRouteSchema
        .extend({
          scope: z.enum(['backups', 'deployments', 'overview', 'settings']),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    return getProjectSectionContext({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      scope: data.scope,
    })
  })

export const getDeployment = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: { deploymentId: string; projectName: string; teamSlug: string }) =>
      deploymentRouteSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    return getDeploymentSectionContext({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      deploymentId: data.deploymentId,
    })
  })

export const getDeploymentLogs = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: { deploymentId: string; projectName: string; teamSlug: string }) =>
      deploymentRouteSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    return getDeploymentLogsContext({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      deploymentId: data.deploymentId,
    })
  })

export const getProjectLogs = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      branch?: string | null
      date?: string | null
      deploymentId?: string | null
      environmentId?: string | null
      keyword?: string | null
      projectName: string
      teamSlug: string
    }) => projectLogsSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    return getProjectLogsSectionContext({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      branch: data.branch,
      date: data.date,
      deploymentId: data.deploymentId,
      environmentId: data.environmentId,
      keyword: data.keyword,
    })
  })

export const saveProjectSettings = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: z.input<typeof projectSettingsSchema>) => data)
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before saving project settings.',
    )
    const parsed = projectSettingsSchema.safeParse(data)
    if (!parsed.success)
      return {
        context: null,
        fieldErrors: projectValidationErrors(parsed.error.issues),
      }
    try {
      const context = await updateProjectSettings({
        userId: session.user.id,
        ...parsed.data,
      })
      return { context, fieldErrors: null }
    } catch (error) {
      const fieldErrors = projectSettingsErrors(error)
      if (fieldErrors) return { context: null, fieldErrors }
      throw error
    }
  })

export const deleteProjectAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      confirmationName: string
      projectName: string
      removeDeployments?: boolean
      teamSlug: string
    }) => deleteProjectSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before deleting a project.',
    )

    return deleteProject({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      confirmationName: data.confirmationName,
      removeDeployments: data.removeDeployments,
    })
  })

export const saveProjectRoutes = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      settingsVersion: number
      projectId: string
      projectName: string
      routes: Array<{
        path: string
        port: number
        service: string
        environmentId?: string
        stripPrefix?: boolean
      }>
      teamSlug: string
    }) => projectRoutesSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession('Sign in before saving routes.')

    return updateProjectRoutes({
      settingsVersion: data.settingsVersion,
      projectId: data.projectId,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      routes: data.routes,
    })
  })

export const saveProjectDomains = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      settingsVersion: number
      projectId: string
      domains: Array<{
        basePath: string
        environmentId: string
        host: string
        https: boolean
      }>
      projectName: string
      teamSlug: string
    }) => projectDomainsSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession('Sign in before saving domains.')

    return updateProjectDomains({
      settingsVersion: data.settingsVersion,
      projectId: data.projectId,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      domains: data.domains,
    })
  })

export const verifyProjectDomainAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: { domainId: string; projectName: string; teamSlug: string }) =>
      projectRouteSchema
        .extend({ domainId: z.string().trim().min(1) })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before verifying domains.',
    )

    return verifyProjectDomain({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      domainId: data.domainId,
    })
  })

export const saveProjectEnvironments = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      settingsVersion: number
      projectId: string
      environments: Array<{
        branch: string
        color: string
        id: string
        name: string
        position: number
        slug: string
        status: 'active' | 'deleted'
      }>
      projectName: string
      teamSlug: string
    }) => projectEnvironmentsSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before saving project environments.',
    )

    return updateProjectEnvironments({
      settingsVersion: data.settingsVersion,
      projectId: data.projectId,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      projectEnvironments: data.environments,
    })
  })

export const saveProjectEnvironmentServers = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      settingsVersion: number
      projectId: string
      defaultServerId: string | null
      projectName: string
      environmentServers: Array<{
        environmentId: string
        serverId: string | null
      }>
      teamSlug: string
    }) => projectEnvironmentServersSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before saving project servers.',
    )

    return updateProjectEnvironmentServers({
      settingsVersion: data.settingsVersion,
      projectId: data.projectId,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      defaultServerId: data.defaultServerId,
      environmentServers: data.environmentServers,
    })
  })

export const saveProjectEnvVars = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      settingsVersion: number
      projectId: string
      envVars: Array<{ environment?: string; key: string; value: string }>
      projectName: string
      teamSlug: string
    }) => projectEnvVarsSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before saving project environment variables.',
    )

    return updateProjectEnvVars({
      settingsVersion: data.settingsVersion,
      projectId: data.projectId,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      envVars: data.envVars,
    })
  })

export const saveProjectBackupPolicyAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      teamSlug: string
      projectId: string
      projectName: string
      settingsVersion: number | null
      policy: z.input<typeof backupConfigSchema>
    }) =>
      projectRouteSchema
        .extend({
          projectId: z.string().min(1),
          settingsVersion: settingsVersionSchema.nullable(),
          policy: backupConfigSchema,
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    requireBackupsEnabled()
    const session = await requireAuthSession()
    return saveProjectBackupPolicy({
      ...data,
      userId: session.user.id,
      policy: { ...data.policy, id: data.policy.id || randomUUID() },
    })
  })

export const deleteProjectBackupPolicyAction = createServerFn({
  method: 'POST',
})
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      teamSlug: string
      projectId: string
      projectName: string
      settingsVersion: number
      policyId: string
    }) =>
      projectRouteSchema
        .extend({
          projectId: z.string().min(1),
          settingsVersion: settingsVersionSchema,
          policyId: z.string().min(1),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    requireBackupsEnabled()
    const session = await requireAuthSession()
    return deleteProjectBackupPolicy({ ...data, userId: session.user.id })
  })

export const runProjectBackup = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: { backupConfigId: string; projectName: string; teamSlug: string }) =>
      backupRouteSchema.parse(data),
  )
  .handler(async ({ data }) => {
    requireBackupsEnabled()
    const session = await requireAuthSession('Sign in before running a backup.')

    return createManualBackupRun({
      backupConfigId: data.backupConfigId,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
    })
  })

export const restoreProjectBackup = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
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
          }
      >
      projectName: string
      teamSlug: string
    }) => backupRestoreSchema.parse(data),
  )
  .handler(async ({ data }) => {
    requireBackupsEnabled()
    const session = await requireAuthSession(
      'Sign in before restoring a backup.',
    )

    return createBackupRestoreJob({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      backupRunId: data.backupRunId,
      artifacts: data.artifacts,
    })
  })

export const deployProject = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      environmentId: string
      gitBranch: string
      gitSha?: string
      projectName: string
      teamSlug: string
    }) => deployProjectSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before deploying a project.',
    )

    return createManualDeployment({
      environmentId: data.environmentId,
      gitBranch: data.gitBranch,
      gitSha: data.gitSha,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
    })
  })

export const rollbackProjectDeployment = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: { deploymentId: string; projectName: string; teamSlug: string }) =>
      deploymentRouteSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before rolling back a deployment.',
    )

    return createRollbackDeployment({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      deploymentId: data.deploymentId,
    })
  })

export const redeployProjectDeployment = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: { deploymentId: string; projectName: string; teamSlug: string }) =>
      deploymentRouteSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before redeploying a deployment.',
    )

    return createRedeployDeployment({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      deploymentId: data.deploymentId,
    })
  })

export const getProjectDeployOptions = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      environmentId: string
      projectName: string
      teamSlug: string
      branch?: string
    }) => deployOptionsSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before deploying a project.',
    )

    return getManualDeploymentOptions({
      branch: data.branch,
      environmentId: data.environmentId,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
    })
  })
