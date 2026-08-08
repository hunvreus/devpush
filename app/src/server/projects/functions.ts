import { randomUUID } from 'node:crypto'

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { config } from '@/server/config'

import { getAuthSession } from '@/server/auth/session.server'
import {
  createManualDeployment,
  createManualBackupRun,
  createBackupRestoreJob,
  createProjectFromGitHub,
  createRedeployDeployment,
  createRollbackDeployment,
  deleteProject,
  getDeploymentContext,
  getManualDeploymentOptions,
  getProjectLogsContext,
  getProjectContext,
  getRepositorySelection,
  listRepositorySelectionRepositories,
  updateProjectEnvironments,
  updateProjectDomains,
  updateProjectEnvVars,
  updateProjectRoutes,
  updateProjectSettings,
  updateProjectEnvironmentServers,
  updateProjectBackupConfigs,
} from '@/server/projects/service'
import {
  getUserContext,
  listTeamProjects,
  listTeamServers,
  requireTeam,
} from '@/server/teams/service'

const teamSlugSchema = z.object({
  teamSlug: z.string().min(1),
})

const envVarSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      'Environment variable keys must use shell-compatible names.',
    ),
  value: z.string(),
  environment: z.string().trim().optional(),
})

const projectMachineNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
    'Project names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.',
  )

const createProjectSchema = z.object({
  teamSlug: z.string().min(1),
  installationId: z.number().int().positive(),
  serverId: z.string().trim().optional().nullable(),
  composePath: z.string().trim().max(255).optional(),
  envVars: z.array(envVarSchema).optional(),
  projectName: projectMachineNameSchema,
  repoFullName: z
    .string()
    .min(1)
    .regex(/^[^/\s]+\/[^/\s]+$/, 'Select a valid GitHub repository.'),
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
  artifacts: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          artifactId: z.string().min(1),
          type: z.literal('volume'),
          targetVolume: z.string().trim().min(1).max(128),
        }),
        z.object({
          artifactId: z.string().min(1),
          type: z.literal('database'),
          targetService: z.string().trim().min(1).max(128),
          restoreCommand: z.string().trim().min(1).max(2_000),
        }),
      ]),
    )
    .min(1),
})

const projectLogsSchema = projectRouteSchema.extend({
  branch: z.string().trim().optional().nullable(),
  date: z.string().trim().optional().nullable(),
  deploymentId: z.string().trim().optional().nullable(),
  environmentId: z.string().trim().optional().nullable(),
  keyword: z.string().trim().optional().nullable(),
})

const projectEnvironmentSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
      'Environment identifiers can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.',
    ),
  branch: z.string().trim().min(1).max(255),
  color: z.string().trim().min(1).max(32),
  position: z.number().int().nonnegative(),
  status: z.enum(['active', 'deleted']),
  effectiveServerId: z.string().trim().min(1).nullable(),
  serverId: z.string().trim().min(1).nullable(),
})

const routeSchema = z.object({
  service: z
    .string()
    .trim()
    .min(1)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'Route services can only contain letters, numbers, dots, underscores, and hyphens.',
    ),
  port: z
    .number()
    .int()
    .min(1, 'Route ports must be between 1 and 65535.')
    .max(65535, 'Route ports must be between 1 and 65535.'),
  path: z
    .string()
    .trim()
    .min(1)
    .regex(/^\//, 'Route paths must start with /.')
    .regex(/^[^\s`]+$/, 'Route paths cannot contain spaces or ` characters.'),
  stripPrefix: z.boolean().optional().default(false),
})

const domainSchema = z.object({
  host: z
    .string()
    .toLowerCase()
    .trim()
    .min(1)
    .max(253)
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/,
      'Domains must be valid DNS hostnames without protocol, path, wildcard, or port.',
    ),
  environmentId: z.string().trim().min(1),
  basePath: z.string().trim(),
  https: z.boolean(),
})

const projectSettingsSchema = projectRouteSchema.extend({
  currentProjectName: z.string().min(1),
  projectName: projectMachineNameSchema,
  repoFullName: z
    .string()
    .min(1)
    .regex(/^[^/\s]+\/[^/\s]+$/, 'Select a valid GitHub repository.'),
  installationId: z.number().int().positive().nullable(),
  avatarDataUrl: z
    .string()
    .max(3_000_000)
    .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,/)
    .nullable()
    .optional(),
  deleteAvatar: z.boolean().optional(),
  composePath: z.string().trim().min(1).max(255),
  releaseCommand: z.string().trim().nullable(),
  releaseService: z.string().trim().min(1).nullable(),
  readinessPath: z
    .string()
    .trim()
    .regex(/^\//, 'Readiness paths must start with /.')
    .nullable(),
})

const projectRoutesSchema = projectRouteSchema.extend({
  routes: z.array(routeSchema).min(1),
})

const projectDomainsSchema = projectRouteSchema.extend({
  domains: z.array(domainSchema),
})

const projectEnvironmentsSchema = projectRouteSchema.extend({
  environments: z.array(projectEnvironmentSchema).min(1),
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

const projectEnvVarsSchema = projectRouteSchema.extend({
  envVars: z.array(envVarSchema),
})

const backupDatabaseDumpSchema = z.object({
  service: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'Backup dump services can only contain letters, numbers, dots, underscores, and hyphens.',
    ),
  command: z.string().trim().min(1).max(2_000),
})

const backupScheduleSchema = z.object({
  cron: z
    .string()
    .trim()
    .regex(
      /^(\S+\s+){4}\S+$/,
      'Backup schedules must use a five-field cron expression.',
    ),
})

const backupVolumesSchema = z.object({
  mode: z.enum(['none', 'allNamed', 'selected']),
  names: z.array(
    z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        'Backup volume names can only contain letters, numbers, dots, underscores, and hyphens.',
      ),
  ),
})

const backupConfigSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1).max(100),
  environmentId: z.string().trim().min(1),
  enabled: z.boolean(),
  schedule: backupScheduleSchema,
  destination: z.object({
    bucket: z
      .string()
      .trim()
      .min(3)
      .max(63)
      .regex(
        /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
        'S3 bucket names must use lowercase DNS-compatible characters.',
      ),
    region: z.string().trim().min(1).max(100).optional(),
    endpoint: z.string().trim().url().optional(),
    prefix: z.string().trim().max(512).optional(),
    accessKeyId: z.string().trim().min(1).max(256).optional(),
    secretAccessKey: z.string().trim().min(1).max(1_024).optional(),
    clearSecretAccessKey: z.boolean().optional(),
  }),
  retention: z.object({
    local: z.object({
      count: z.number().int().min(0).max(10_000),
      days: z.number().int().min(0).max(3650),
      maxStorageGb: z.number().min(0).max(100_000),
    }),
    remote: z.object({
      enabled: z.boolean(),
      count: z.number().int().min(0).max(10_000),
      days: z.number().int().min(0).max(3650),
      maxStorageGb: z.number().min(0).max(100_000),
    }),
  }),
  volumes: backupVolumesSchema,
  databaseDumps: z.array(backupDatabaseDumpSchema),
})

const projectBackupConfigsSchema = projectRouteSchema.extend({
  backupConfigs: z.array(backupConfigSchema),
})

const repositorySelectionRepositoriesSchema = z.object({
  teamSlug: z.string().min(1),
  installationId: z.number().int().positive(),
})

export const getNewProjectContext = createServerFn({ method: 'GET' })
  .validator((data: { teamSlug: string }) => teamSlugSchema.parse(data))
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const [userContext, team] = await Promise.all([
      getUserContext(session.user.id),
      requireTeam(session.user.id, data.teamSlug),
    ])
    const [projects, servers, repositorySelection] = await Promise.all([
      listTeamProjects(team.id),
      listTeamServers(team.id),
      getRepositorySelection({
        userId: session.user.id,
        teamSlug: data.teamSlug,
      }),
    ])

    return {
      userContext,
      team,
      projects,
      servers,
      repositorySelection,
    }
  })

export const getRepositorySelectionRepositories = createServerFn({
  method: 'GET',
})
  .validator((data: { installationId: number; teamSlug: string }) =>
    repositorySelectionRepositoriesSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before selecting a repository.')
    }

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
      repoFullName: string
      serverId?: string | null
      teamSlug: string
    }) => createProjectSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before creating a project.')
    }

    return createProjectFromGitHub({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      repoFullName: data.repoFullName,
      installationId: data.installationId,
      serverId: data.serverId?.trim() || null,
      composePath: data.composePath ?? '',
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

    return getDeploymentContext({
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

    return getProjectLogsContext({
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
  .validator(
    (data: {
      composePath: string
      avatarDataUrl?: string | null
      deleteAvatar?: boolean
      installationId: number | null
      currentProjectName: string
      projectName: string
      repoFullName: string
      readinessPath: string | null
      releaseCommand: string | null
      releaseService: string | null
      teamSlug: string
    }) => projectSettingsSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before saving project settings.')
    }

    return updateProjectSettings({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      currentProjectName: data.currentProjectName,
      projectName: data.projectName,
      repoFullName: data.repoFullName,
      installationId: data.installationId,
      avatarDataUrl: data.avatarDataUrl,
      deleteAvatar: data.deleteAvatar,
      composePath: data.composePath,
      releaseCommand: data.releaseCommand || null,
      releaseService: data.releaseService || null,
      readinessPath: data.readinessPath || null,
    })
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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before deleting a project.')
    }

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
        stripPrefix?: boolean
      }>
      teamSlug: string
    }) => projectRoutesSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before saving routes.')
    }

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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before saving domains.')
    }

    return updateProjectDomains({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
      domains: data.domains,
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
        serverId: string | null
      }>
      projectName: string
      teamSlug: string
    }) => projectEnvironmentsSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before saving project environments.')
    }

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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before saving project servers.')
    }

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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before saving project environment variables.')
    }

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
          command: string
          service: string
        }>
        destination: {
          accessKeyId?: string
          bucket: string
          clearSecretAccessKey?: boolean
          endpoint?: string
          prefix?: string
          region?: string
          secretAccessKey?: string
        }
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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before saving backup settings.')
    }

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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before running a backup.')
    }

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
            restoreCommand: string
          }
      >
      projectName: string
      teamSlug: string
    }) => backupRestoreSchema.parse(data),
  )
  .handler(async ({ data }) => {
    requireBackupsEnabled()
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before restoring a backup.')
    }

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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before deploying a project.')
    }

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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before rolling back a deployment.')
    }

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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before redeploying a deployment.')
    }

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
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before deploying a project.')
    }

    return getManualDeploymentOptions({
      environmentId: data.environmentId,
      userId: session.user.id,
      teamSlug: data.teamSlug,
      projectName: data.projectName,
    })
  })
