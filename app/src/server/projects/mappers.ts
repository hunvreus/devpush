import type {
  aliases,
  backupArtifacts,
  backupConfigs,
  backupRuns,
  deployments,
  domains,
  environments,
  projects,
  servers,
} from '@/server/db/schema'
import { backupRetentionSchema } from '@/server/backups/service'
import type {
  BackupDatabaseDump,
  BackupDestination,
  BackupVolumeSelection,
} from '@/server/backups/service'
import { getResourceColor } from '@/server/resources/color'
import { getEffectiveServerStatus } from '@/server/servers/status'
import { normalizeDeploymentCommitMeta } from './deployment-config'
import type {
  ProjectBackupArtifact,
  ProjectBackupConfig,
  ProjectBackupRun,
  ProjectBackupSchedule,
  ProjectContext,
  ProjectDomain,
  DeploymentSummary,
  ProjectEnvironmentConfig,
  ProjectEnvironmentVariable,
  ProjectPublicRoute,
  ProjectRoute,
} from './service'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mapEnvironment(
  environment: typeof environments.$inferSelect,
  server: typeof servers.$inferSelect | null,
): ProjectContext['environment'] {
  return {
    id: environment.id,
    name: environment.name,
    slug: environment.slug,
    branch: environment.branch,
    color: environment.color,
    position: environment.position,
    defaultHost: null,
    serverId: server?.id ?? null,
    serverName: server?.name ?? null,
    serverStatus: server
      ? getEffectiveServerStatus({
          status: server.status,
          lastSeenAt: server.lastSeenAt,
        })
      : null,
    serverAgentUpdate: null,
    envVars: [],
    publicRoutes: [],
    runtime: null,
  }
}

export function mapRuntimeObservation(
  observation: {
    lastSeenAt: Date
    services: unknown
  } | null,
): ProjectContext['environment']['runtime'] {
  if (!observation || !Array.isArray(observation.services)) {
    return null
  }

  const services = observation.services.flatMap((value) => {
    if (!isRecord(value)) {
      return []
    }
    const name = typeof value.name === 'string' ? value.name : null
    const containerName =
      typeof value.containerName === 'string' ? value.containerName : null
    const state = typeof value.state === 'string' ? value.state : null
    if (!name || !containerName || !state) {
      return []
    }
    return [
      {
        name,
        containerName,
        state,
        health: typeof value.health === 'string' ? value.health : null,
        restartCount:
          typeof value.restartCount === 'number' ? value.restartCount : 0,
        startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
        exitCode: typeof value.exitCode === 'number' ? value.exitCode : 0,
      },
    ]
  })

  return {
    observedAt: observation.lastSeenAt.toISOString(),
    services,
  }
}

export function mapDeployment({
  deployment,
  deploymentAlias,
  environment,
  project,
  server,
}: {
  deployment: typeof deployments.$inferSelect
  deploymentAlias?: typeof aliases.$inferSelect | null
  environment: typeof environments.$inferSelect
  project: typeof projects.$inferSelect
  server?: typeof servers.$inferSelect | null
}): DeploymentSummary {
  const commitMeta = normalizeDeploymentCommitMeta(deployment.commitMeta)

  return {
    id: deployment.id,
    status: deployment.status,
    phase: deployment.phase,
    trigger: deployment.trigger,
    gitSha: deployment.gitSha,
    gitBranch: deployment.gitBranch,
    githubRepo: deployment.repoFullName,
    deploymentHost: deploymentAlias?.hostname ?? null,
    deploymentRouteHttps: deploymentAlias?.https ?? true,
    commitMessage: commitMeta.message,
    errorMessage: deployment.errorMessage,
    createdAt: deployment.createdAt.toISOString(),
    startedAt: deployment.startedAt?.toISOString() ?? null,
    finishedAt: deployment.finishedAt?.toISOString() ?? null,
    environmentName: environment.name,
    environmentSlug: environment.slug,
    environmentColor: environment.color,
    serverId: server?.id ?? deployment.serverId,
    serverName: server?.name ?? 'Unknown server',
    serverStatus: server
      ? getEffectiveServerStatus({
          status: server.status,
          lastSeenAt: server.lastSeenAt,
        })
      : 'disconnected',
    projectName: project.name,
    projectColor: getResourceColor(project.id),
  }
}

export function normalizeEnvVars(
  value: unknown,
): Array<ProjectEnvironmentVariable> {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (item): item is ProjectEnvironmentVariable =>
        typeof item === 'object' &&
        item !== null &&
        'key' in item &&
        'value' in item &&
        typeof item.key === 'string' &&
        typeof item.value === 'string',
    )
    .map((item) => ({
      key: item.key,
      value: item.value,
      environment:
        'environment' in item && typeof item.environment === 'string'
          ? item.environment
          : '',
    }))
    .filter((item) => item.key.trim() !== '')
}

export function mapEnvironmentConfig(
  environment: typeof environments.$inferSelect,
  defaultServerId: string | null,
): ProjectEnvironmentConfig {
  return {
    id: environment.id,
    name: environment.name,
    slug: environment.slug,
    branch: environment.branch,
    color: environment.color,
    position: environment.position,
    status: environment.status,
    effectiveServerId: environment.serverId ?? defaultServerId,
    serverId: environment.serverId,
  }
}

export function getProductionEnvironment(
  environmentsConfig: Array<ProjectEnvironmentConfig>,
) {
  return (
    environmentsConfig.find(
      (environment) => environment.slug === 'production',
    ) ?? environmentsConfig[0]
  )
}

export function normalizeProjectRoutes(value: unknown): Array<ProjectRoute> {
  if (!Array.isArray(value)) {
    return []
  }

  const routes = value
    .filter(
      (item): item is ProjectRoute =>
        typeof item === 'object' &&
        item !== null &&
        'service' in item &&
        'port' in item &&
        'path' in item &&
        typeof item.service === 'string' &&
        typeof item.port === 'number' &&
        typeof item.path === 'string',
    )
    .map((route) => ({
      ...route,
      stripPrefix:
        'stripPrefix' in route && typeof route.stripPrefix === 'boolean'
          ? route.stripPrefix
          : false,
      environmentId:
        'environmentId' in route && typeof route.environmentId === 'string'
          ? route.environmentId
          : undefined,
    }))
    .filter((route) => route.service && route.path.startsWith('/'))

  return routes
}

export function getEffectiveProjectRoutes(
  routes: Array<ProjectRoute>,
  environmentId: string,
) {
  const effective = new Map<string, ProjectRoute>()

  for (const route of routes) {
    if (!route.environmentId) {
      effective.set(route.path, route)
    }
  }
  for (const route of routes) {
    if (route.environmentId === environmentId) {
      effective.set(route.path, route)
    }
  }

  return Array.from(effective.values(), (route) => ({
    ...route,
    environmentId: undefined,
  }))
}

export type RouteHostname = {
  hostname: string
  environmentId: string
  basePath: string | null
  https: boolean
}

export function expandPublicRoutesFromHostnames(
  routes: Array<ProjectRoute>,
  hostnameRows: Array<RouteHostname>,
): Array<ProjectPublicRoute> {
  return hostnameRows.flatMap((hostname) => {
    const targetRoutes = hostname.basePath
      ? routes.filter((route) => route.path === hostname.basePath)
      : routes

    return targetRoutes.map((route) => ({
      host: hostname.hostname,
      https: hostname.https,
      path: route.path,
      port: route.port,
      service: route.service,
      stripPrefix: route.stripPrefix,
    }))
  })
}

export function toRouteHostnames(
  aliasRows: Array<typeof aliases.$inferSelect>,
  domainRows: Array<typeof domains.$inferSelect>,
): Array<RouteHostname> {
  return [
    ...aliasRows.map((alias) => ({
      hostname: alias.hostname,
      environmentId: alias.environmentId,
      basePath: null,
      https: alias.https,
    })),
    ...domainRows.map((domain) => ({
      hostname: domain.hostname,
      environmentId: domain.environmentId,
      basePath: domain.basePath,
      https: domain.https,
    })),
  ]
}

export function mapProjectDomains(
  domainRows: Array<typeof domains.$inferSelect>,
): Array<ProjectDomain> {
  return domainRows.map((domain) => ({
    id: domain.id,
    host: domain.hostname,
    environmentId: domain.environmentId,
    basePath: domain.basePath,
    https: domain.https,
    status: domain.status,
    message: domain.message,
    verifiedAt: domain.verifiedAt,
  }))
}

export function mapBackupConfig(
  backupConfig: typeof backupConfigs.$inferSelect,
): ProjectBackupConfig {
  const destination =
    typeof backupConfig.destination === 'object' &&
    backupConfig.destination !== null
      ? (backupConfig.destination as Partial<BackupDestination>)
      : {}
  const retention = backupRetentionSchema.parse(backupConfig.retention)
  const databaseDumps = Array.isArray(backupConfig.databaseDumps)
    ? backupConfig.databaseDumps.filter(
        (dump): dump is BackupDatabaseDump =>
          typeof dump === 'object' &&
          dump !== null &&
          'service' in dump &&
          'command' in dump &&
          typeof dump.service === 'string' &&
          typeof dump.command === 'string',
      )
    : []

  return {
    id: backupConfig.id,
    name: backupConfig.name,
    environmentId: backupConfig.environmentId,
    enabled: backupConfig.enabled,
    schedule: parseBackupSchedule(backupConfig.schedule),
    destination: {
      bucket: destination.bucket ?? '',
      region: destination.region,
      endpoint: destination.endpoint,
      prefix: destination.prefix,
      accessKeyId: destination.accessKeyId,
      secretAccessKeyPreview: destination.secretAccessKeyPreview
        ? 'Configured'
        : undefined,
    },
    retention,
    volumes: normalizeBackupVolumes(backupConfig.volumes),
    databaseDumps,
  }
}

export function maskSecret(value: string) {
  return value.length > 0 ? 'Configured' : ''
}

export function mapBackupRun(
  {
    backupRun,
    environment,
    server,
  }: {
    backupRun: typeof backupRuns.$inferSelect
    environment: typeof environments.$inferSelect
    server: typeof servers.$inferSelect | null
  },
  projectEnvironments: Array<ProjectEnvironmentConfig>,
  artifacts: Array<typeof backupArtifacts.$inferSelect>,
): ProjectBackupRun {
  const environmentConfig =
    projectEnvironments.find((item) => item.id === environment.id) ?? null

  return {
    id: backupRun.id,
    status: backupRun.status,
    environmentId: environment.id,
    environmentName: environmentConfig?.name ?? environment.name,
    environmentColor:
      environmentConfig?.color ?? getResourceColor(environment.name),
    serverId: server?.id ?? null,
    serverName: server?.name ?? null,
    errorMessage: backupRun.errorMessage,
    startedAt: backupRun.startedAt?.toISOString() ?? null,
    finishedAt: backupRun.finishedAt?.toISOString() ?? null,
    createdAt: backupRun.createdAt.toISOString(),
    artifacts: artifacts.map(mapBackupArtifact),
  }
}

function mapBackupArtifact(
  artifact: typeof backupArtifacts.$inferSelect,
): ProjectBackupArtifact {
  return {
    id: artifact.id,
    type: artifact.type,
    storage: artifact.storage,
    objectKey: artifact.objectKey,
    checksumSha256: artifact.checksumSha256,
    sizeBytes: artifact.sizeBytes,
    createdAt: artifact.createdAt.toISOString(),
  }
}

export function parseBackupSchedule(value: unknown): ProjectBackupSchedule {
  if (typeof value === 'object' && value !== null) {
    const schedule = value as Partial<ProjectBackupSchedule>

    if (typeof schedule.cron === 'string' && isCronSchedule(schedule.cron)) {
      return { cron: schedule.cron.trim() }
    }
  }

  throw new Error('Backup schedules must use a five-field cron expression.')
}

export function normalizeBackupVolumes(value: unknown): BackupVolumeSelection {
  if (typeof value === 'object' && value !== null) {
    const volumes = value as Partial<BackupVolumeSelection>

    if (volumes.mode === 'none') {
      return { mode: 'none', names: [] }
    }

    if (volumes.mode === 'selected' && Array.isArray(volumes.names)) {
      const names = volumes.names
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)

      return names.length > 0
        ? { mode: 'selected', names }
        : { mode: 'allNamed', names: [] }
    }
  }

  return { mode: 'allNamed', names: [] }
}

function isCronSchedule(value: string) {
  return /^(\S+\s+){4}\S+$/.test(value.trim())
}

export function getEnvVarsForEnvironment(
  envVars: Array<ProjectEnvironmentVariable>,
  environment: string,
) {
  const values = new Map<string, ProjectEnvironmentVariable>()

  for (const envVar of envVars) {
    if (!envVar.environment) {
      values.set(envVar.key, envVar)
    }
  }

  for (const envVar of envVars) {
    if (envVar.environment === environment) {
      values.set(envVar.key, envVar)
    }
  }

  return Array.from(values.values())
}

export function findDuplicate(values: Array<string>) {
  const seen = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      return value
    }

    seen.add(value)
  }

  return null
}
