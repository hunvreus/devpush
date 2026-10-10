import type { BackupDatabaseDump } from '@/server/backups/service'
import { backupConfigSchema } from '@/lib/backup-policy-schema'
import { backupRestoreArtifactSchema } from '@/lib/backup-restore-schema'
import { projectEnvironmentsSchema } from '@/lib/project-environments-schema'
import { projectEnvVarsSchema } from '@/lib/project-env-schema'
import {
  projectRoutesSchema,
  projectDomainsSchema,
} from '@/lib/project-routing-schema'
import type { envVarSchema } from '@/lib/project-creation-schema'
import { createProjectSchema } from '@/lib/project-creation-schema'
import {
  projectSettingsSchema,
  projectSettingsErrors,
  projectValidationErrors,
} from '@/lib/project-settings-schema'
import { randomUUID } from 'node:crypto'

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { config } from '@/server/config'

import {
  getAuthSession,
  requireAuthSession,
} from '@/server/auth/session.server'
import {
  createManualDeployment,
  createRedeployDeployment,
  createRollbackDeployment,
  getManualDeploymentOptions,
} from '@/server/projects/deployments'
import {
  updateProjectEnvironments,
  updateProjectEnvironmentServers,
  updateProjectEnvVars,
} from '@/server/projects/environments'
import {
  deleteProject,
  updateProjectDomains,
  updateProjectRoutes,
  updateProjectSettings,
  verifyProjectDomain,
} from '@/server/projects/settings'
import {
  createBackupRestoreJob,
  createManualBackupRun,
  updateProjectBackupConfigs,
} from '@/server/projects/backups'
import {
  getDeploymentLogsContext,
  getDeploymentSectionContext,
  getProjectContext,
  getProjectLogsSectionContext,
  getProjectSectionContext,
} from '@/server/projects/context'
import {
  createProjectFromGitHub,
  getRepositorySelection,
  listRepositorySelectionRepositories,
} from '@/server/projects/repository'

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
  defaultServerId: z.string().trim().min(1).nullable(),
  environmentServers: z.array(
    z.object({
      environmentId: z.string().trim().min(1),
      serverId: z.string().trim().min(1).nullable(),
    }),
  ),
})

const projectBackupConfigsSchema = projectRouteSchema.extend({
  backupConfigs: z.array(backupConfigSchema),
})

const repositorySelectionRepositoriesSchema = z.object({
  teamSlug: z.string().min(1),
  installationId: z.number().int().positive(),
})

export const getRepositorySelectionContext = createServerFn({ method: 'GET' })
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
  .validator(
    (data: {
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
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      routes: data.routes,
    })
  })

export const saveProjectDomains = createServerFn({ method: 'POST' })
  .validator(
    (data: {
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
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      domains: data.domains,
    })
  })

export const verifyProjectDomainAction = createServerFn({ method: 'POST' })
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
  .validator(
    (data: {
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
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      projectEnvironments: data.environments,
    })
  })

export const saveProjectEnvironmentServers = createServerFn({ method: 'POST' })
  .validator(
    (data: {
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
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      defaultServerId: data.defaultServerId,
      environmentServers: data.environmentServers,
    })
  })

export const saveProjectEnvVars = createServerFn({ method: 'POST' })
  .validator(
    (data: {
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
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      envVars: data.envVars,
    })
  })

export const saveProjectBackupConfigs = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      backupConfigs: Array<{
        databaseDumps: Array<{
          engine: BackupDatabaseDump['engine']
          database: string
          service: string
        }>
        destination: { storageId?: string; prefix?: string }
        enabled: boolean
        environmentId: string
        id?: string
        name: string
        retention: {
          local: {
            count: number
            days: number
            maxStorageGb: number
          }
          remote: {
            enabled: boolean
            count: number
            days: number
            maxStorageGb: number
          }
        }
        schedule: {
          cron: string
        }
        volumes: {
          mode: 'none' | 'allNamed' | 'selected'
          names: Array<string>
        }
      }>
      projectName: string
      teamSlug: string
    }) => projectBackupConfigsSchema.parse(data),
  )
  .handler(async ({ data }) => {
    requireBackupsEnabled()
    const session = await requireAuthSession(
      'Sign in before saving backup settings.',
    )

    return updateProjectBackupConfigs({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      backupConfigs: data.backupConfigs.map((backupConfig) => ({
        ...backupConfig,
        id: backupConfig.id ?? randomUUID(),
      })),
    })
  })

export const runProjectBackup = createServerFn({ method: 'POST' })
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

function requireBackupsEnabled() {
  if (!config.DEVPUSH_BACKUPS_ENABLED) {
    throw new Error('Backups are not enabled for this installation.')
  }
}

export const deployProject = createServerFn({ method: 'POST' })
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
  .validator(
    (data: { environmentId: string; projectName: string; teamSlug: string }) =>
      deployOptionsSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before deploying a project.',
    )

    return getManualDeploymentOptions({
      environmentId: data.environmentId,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
    })
  })
