import type {
  BackupStorageReference,
  BackupStorageSummary,
} from '@/lib/backup-storage-schema'
import type {
  BackupDatabaseDump,
  BackupRetentionPolicy,
  BackupVolumeSelection,
} from '@/server/backups/service'
import type { getResourceColor } from '@/server/resources/color'
import type { ServerStatus } from '@/server/servers/status'
import type {
  ProjectSummary,
  ServerSummary,
  TeamSummary,
  UserContext,
} from '@/server/teams/types'
import type { ProjectComposeMetadata } from './compose-metadata'
import type { ProjectRuntimeConfig } from '@/lib/project-runtime-config'

export type RepositorySelectionContext = {
  github:
    | {
        connected: true
        login: string
        appConfigured: boolean
        installUrl: string | null
        installations: Array<{
          id: number
          accountLogin: string
          accountType: string
          repositorySelection: string
        }>
        repositories: Array<{
          id: number
          installationId: number
          name: string
          fullName: string
          owner: string
          private: boolean
          defaultBranch: string
          updatedAt: string
          permissions: {
            push: boolean
          }
        }>
      }
    | {
        connected: false
        login: null
        appConfigured: boolean
        installUrl: string | null
        installations: []
        repositories: []
      }
}

export type CreatedProject = {
  id: string
  name: string
  githubRepo: string
  composePath: string | null
}

export type ProjectPublicRoute = {
  host: string
  service: string
  port: number
  path: string
  https: boolean
  stripPrefix: boolean
}

export type ProjectRoute = {
  service: string
  port: number
  path: string
  stripPrefix: boolean
  environmentId?: string
}

export type ProjectDomain = {
  id: string
  host: string
  environmentId: string
  basePath: string | null
  https: boolean
  status: 'pending' | 'active' | 'disabled' | 'failed'
  message: string | null
  verifiedAt: Date | null
}

export type ProjectEnvironmentVariable = {
  key: string
  value: string
  environment?: string
}

export type ProjectEnvironmentConfig = {
  id: string
  name: string
  slug: string
  branch: string
  color: string
  position: number
  status: 'active' | 'deleted'
  effectiveServerId: string | null
  serverId: string | null
}

export type ProjectBackupConfig = {
  settingsVersion: number
  id: string
  name: string
  environmentId: string
  enabled: boolean
  schedule: ProjectBackupSchedule
  destination: BackupStorageReference
  retention: BackupRetentionPolicy
  volumes: BackupVolumeSelection
  databaseDumps: Array<BackupDatabaseDump>
}

export type BackupDestinationInput = BackupStorageReference

export type ProjectBackupSchedule = {
  cron: string
}

export type ProjectBackupRun = {
  id: string
  configId: string | null
  localRecoveryAvailable: boolean
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  environmentId: string
  environmentName: string
  environmentColor: string
  serverId: string | null
  serverName: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  databaseTargets?: Array<BackupDatabaseDump>
  artifacts: Array<ProjectBackupArtifact>
}

export type ProjectBackupRestore = {
  artifacts?: Array<{
    artifactId: string
    type: 'volume' | 'database'
    targetVolume?: string
    targetService?: string
  }>

  serverId?: string | null
  serverName?: string | null
  id: string
  backupRunId: string
  environmentId: string
  status: ProjectBackupRun['status']
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type ProjectBackupArtifact = {
  id: string
  type: 'manifest' | 'volume' | 'database'
  storage: 'local' | 'remote'
  objectKey: string
  checksumSha256: string
  sizeBytes: number
  createdAt: string
}

export type DeploymentSummary = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  phase: string | null
  trigger: 'user' | 'webhook' | 'api' | 'rollback'
  gitSha: string
  gitBranch: string
  githubRepo: string
  deploymentHost: string | null
  deploymentRouteHttps: boolean
  commitMessage: string | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  environmentName: string
  environmentSlug: string
  environmentColor: string
  serverId: string | null
  serverName: string
  serverStatus: ServerStatus
  projectName: string
  projectColor: ReturnType<typeof getResourceColor>
}

export type ProjectContext = {
  userContext: UserContext
  team: TeamSummary
  project: {
    settingsVersion: number
    id: string
    name: string
    githubInstallationId: number | null
    githubRepoId: number | null
    githubRepo: string
    defaultServerId: string | null
    avatarUrl: string | null
    runtimeConfig: ProjectRuntimeConfig
    color: ReturnType<typeof getResourceColor>
  }
  teamProjects: Array<ProjectSummary>
  routes: Array<ProjectRoute>
  composeMetadata: ProjectComposeMetadata | null
  domains: Array<ProjectDomain>
  envVars: Array<ProjectEnvironmentVariable>
  backupStorage?: Array<BackupStorageSummary>
  backupConfigs: Array<ProjectBackupConfig>
  backupRuns: Array<ProjectBackupRun>
  backupRestores: Array<ProjectBackupRestore>
  environment: {
    id: string
    name: string
    slug: string
    branch: string
    color: string
    position: number
    defaultHost: string | null
    serverId: string | null
    serverName: string | null
    serverStatus: ServerStatus | null
    serverAgentUpdate: ServerSummary['agentUpdate'] | null
    envVars: Array<ProjectEnvironmentVariable>
    publicRoutes: Array<ProjectPublicRoute>
    runtime: {
      observedAt: string
      services: Array<{
        name: string
        containerName: string
        state: string
        health: string | null
        restartCount: number
        startedAt: string | null
        exitCode: number
      }>
    } | null
  }
  environments: Array<ProjectEnvironmentConfig>
  deployments: Array<DeploymentSummary>
  servers: Array<ServerSummary>
}

export type ProjectContextScope =
  | 'backups'
  | 'deployments'
  | 'full'
  | 'overview'
  | 'settings'
  | 'shell'

export type ProjectSectionContext =
  | {
      scope: 'overview'
      projectId: string
      deployments: ProjectContext['deployments']
      runtime: ProjectContext['environment']['runtime']
    }
  | {
      scope: 'deployments'
      projectId: string
      deployments: ProjectContext['deployments']
    }
  | {
      scope: 'settings'
      context: ProjectContext
      projectId: string
      composeMetadata: ProjectContext['composeMetadata']
      domains: ProjectContext['domains']
      envVars: ProjectContext['envVars']
    }
  | {
      scope: 'backups'
      projectId: string
      backupStorage?: ProjectContext['backupStorage']
      backupConfigs: ProjectContext['backupConfigs']
      backupRuns: ProjectContext['backupRuns']
      backupRestores: ProjectContext['backupRestores']
      composeMetadata: ProjectContext['composeMetadata']
    }

export type DeploymentContext = {
  userContext: UserContext
  team: TeamSummary
  project: ProjectContext['project']
  teamProjects: Array<ProjectSummary>
  latestDeployments: Array<DeploymentSummary>
  environment: ProjectContext['environment']
  environments: ProjectContext['environments']
  servers: Array<ServerSummary>
  deployment: DeploymentSummary
  logs: Array<{
    seq: number
    stream: string
    content: string
    createdAt: string
  }>
}

export type DeploymentSectionContext = {
  projectId: string
  latestDeployments: Array<DeploymentSummary>
  deployment: DeploymentSummary
}

export type ProjectLogEntry = {
  source: 'deployment' | 'runtime'
  deploymentId: string | null
  runtimeId: string | null
  service: string | null
  stream: string
  seq: number
  content: string
  createdAt: string
}

export type ProjectLogsContext = ProjectContext & {
  logs: Array<ProjectLogEntry>
  hasAnyLogs: boolean
  filters: {
    branch: string | null
    date: string | null
    deploymentId: string | null
    environmentId: string | null
    keyword: string | null
  }
}

export type ProjectLogsSectionContext = {
  projectId: string
  deployments: ProjectContext['deployments']
  logs: ProjectLogsContext['logs']
  hasAnyLogs: boolean
  filters: ProjectLogsContext['filters']
}
