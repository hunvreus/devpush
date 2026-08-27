import { sql } from 'drizzle-orm'
import {
  boolean,
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const teamMemberRole = pgEnum('team_member_role', [
  'owner',
  'admin',
  'member',
])

export const teamInviteStatus = pgEnum('team_invite_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
])

export const serverStatus = pgEnum('server_status', [
  'pending',
  'connected',
  'disconnected',
  'disabled',
  'deleted',
])

export const githubInstallationStatus = pgEnum('github_installation_status', [
  'active',
  'deleted',
  'suspended',
])

export const deploymentStatus = pgEnum('deployment_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
])

export const deploymentTrigger = pgEnum('deployment_trigger', [
  'user',
  'webhook',
  'api',
  'rollback',
])

export const environmentStatus = pgEnum('environment_status', [
  'active',
  'deleted',
])

export const aliasType = pgEnum('alias_type', [
  'deployment',
  'environment',
  'branch',
])

export const domainStatus = pgEnum('domain_status', [
  'pending',
  'active',
  'disabled',
  'failed',
])

export const resourceStatus = pgEnum('resource_status', [
  'active',
  'deleted',
  'banned',
])

export const allowlistType = pgEnum('allowlist_type', [
  'email',
  'domain',
  'pattern',
])

export const agentJobType = pgEnum('agent_job_type', [
  'deploy',
  'deprovision',
  'purge',
  'backup',
  'restore',
  'backup_cleanup',
])

export const agentJobStatus = pgEnum('agent_job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'abandoned',
])

export const userCleanupJobStatus = pgEnum('user_cleanup_job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
])

export const backupDestinationType = pgEnum('backup_destination_type', ['s3'])

export const backupStatus = pgEnum('backup_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
])

export const backupArtifactType = pgEnum('backup_artifact_type', [
  'manifest',
  'volume',
  'database',
])

export const backupArtifactStorage = pgEnum('backup_artifact_storage', [
  'local',
  'remote',
])

export const teams = pgTable(
  'teams',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: resourceStatus('status').notNull().default('active'),
    avatarPath: text('avatar_path'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('teams_slug_idx').on(table.slug)],
)

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    username: text('username').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    status: resourceStatus('status').notNull().default('active'),
    image: text('image'),
    defaultTeamId: text('default_team_id').references(() => teams.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('user_username_idx')
      .on(sql`lower(${table.username})`)
      .where(sql`status = 'active'`),
  ],
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    providerAccountName: text('provider_account_name'),
    providerAccountEmail: text('provider_account_email'),
    providerAccountUsername: text('provider_account_username'),
    providerAccountImage: text('provider_account_image'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const allowlist = pgTable(
  'allowlist',
  {
    id: text('id').primaryKey(),
    type: allowlistType('type').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('allowlist_type_idx').on(table.type),
    uniqueIndex('allowlist_type_value_idx').on(
      table.type,
      sql`lower(${table.value})`,
    ),
  ],
)

export const teamMembers = pgTable(
  'team_members',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: teamMemberRole('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('team_members_team_user_idx').on(table.teamId, table.userId),
    index('team_members_user_idx').on(table.userId),
    index('team_members_team_idx').on(table.teamId),
  ],
)

export const teamInvites = pgTable(
  'team_invites',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: teamMemberRole('role').notNull().default('member'),
    inviterId: text('inviter_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    tokenHash: text('token_hash').notNull(),
    status: teamInviteStatus('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('team_invites_token_hash_idx').on(table.tokenHash),
    uniqueIndex('team_invites_pending_email_idx')
      .on(table.teamId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending'`),
    index('team_invites_team_idx').on(table.teamId),
    index('team_invites_email_idx').on(sql`lower(${table.email})`),
  ],
)

export const githubInstallations = pgTable(
  'github_installations',
  {
    installationId: bigint('installation_id', { mode: 'number' }).primaryKey(),
    accountId: bigint('account_id', { mode: 'number' }),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    repositorySelection: text('repository_selection').notNull(),
    status: githubInstallationStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('github_installations_account_id_idx').on(table.accountId),
    index('github_installations_account_idx').on(table.accountLogin),
    index('github_installations_status_idx').on(table.status),
  ],
)

export const servers = pgTable(
  'servers',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    handle: text('handle').notNull(),
    status: serverStatus('status').notNull().default('pending'),
    agentVersion: text('agent_version'),
    agentProtocolVersion: integer('agent_protocol_version'),
    agentCapabilities: jsonb('agent_capabilities').$type<Array<string>>(),
    publicAddress: text('public_address'),
    hostname: text('hostname'),
    operatingSystem: text('operating_system'),
    kernelVersion: text('kernel_version'),
    architecture: text('architecture'),
    cpuCoreCount: integer('cpu_core_count'),
    hostUptimeSeconds: bigint('host_uptime_seconds', { mode: 'number' }),
    enrollmentTokenHash: text('enrollment_token_hash'),
    enrollmentTokenExpiresAt: timestamp('enrollment_token_expires_at', {
      withTimezone: true,
    }),
    agentCredentialHash: text('agent_credential_hash'),
    pendingAgentCredentialHash: text('pending_agent_credential_hash'),
    agentCredentialRotatedAt: timestamp('agent_credential_rotated_at', {
      withTimezone: true,
    }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('servers_team_handle_idx')
      .on(table.teamId, table.handle)
      .where(sql`${table.status} <> 'deleted'`),
    uniqueIndex('servers_team_name_idx')
      .on(table.teamId, sql`lower(${table.name})`)
      .where(sql`${table.status} <> 'deleted'`),
    index('servers_team_idx').on(table.teamId),
  ],
)

export const serverHeartbeats = pgTable(
  'server_heartbeats',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    agentVersion: text('agent_version'),
    publicAddress: text('public_address'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('server_heartbeats_server_observed_idx').on(
      table.serverId,
      table.observedAt,
    ),
    index('server_heartbeats_observed_idx').on(table.observedAt),
  ],
)

export const serverAvailabilityWindows = pgTable(
  'server_availability_windows',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('server_availability_windows_server_started_idx').on(
      table.serverId,
      table.startedAt,
    ),
  ],
)

export const serverMetrics = pgTable(
  'server_metrics',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    cpuPercent: doublePrecision('cpu_percent'),
    load1: doublePrecision('load_1'),
    memoryUsedBytes: bigint('memory_used_bytes', { mode: 'number' }),
    memoryTotalBytes: bigint('memory_total_bytes', { mode: 'number' }),
    diskUsedBytes: bigint('disk_used_bytes', { mode: 'number' }),
    diskTotalBytes: bigint('disk_total_bytes', { mode: 'number' }),
    networkReceiveBytesPerSecond: doublePrecision(
      'network_receive_bytes_per_second',
    ),
    networkTransmitBytesPerSecond: doublePrecision(
      'network_transmit_bytes_per_second',
    ),
    diskReadBytesPerSecond: doublePrecision('disk_read_bytes_per_second'),
    diskWriteBytesPerSecond: doublePrecision('disk_write_bytes_per_second'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('server_metrics_server_observed_idx').on(
      table.serverId,
      table.observedAt,
    ),
    index('server_metrics_observed_idx').on(table.observedAt),
  ],
)

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: resourceStatus('status').notNull().default('active'),
    githubRepoId: bigint('github_repo_id', { mode: 'number' }),
    githubRepo: text('github_repo').notNull(),
    githubInstallationId: bigint('github_installation_id', {
      mode: 'number',
    }).references(() => githubInstallations.installationId, {
      onDelete: 'restrict',
    }),
    defaultServerId: text('default_server_id').references(() => servers.id, {
      onDelete: 'restrict',
    }),
    avatarPath: text('avatar_path'),
    routes: jsonb('routes'),
    envVars: jsonb('env_vars'),
    runtimeConfig: jsonb('runtime_config')
      .notNull()
      .default(
        sql`'{"type":"compose","path":null,"releaseCommand":null,"releaseService":null,"readinessPath":null,"deployCommand":null,"rollbackCommand":null,"timeoutSeconds":1800}'::jsonb`,
      ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_team_slug_idx')
      .on(table.teamId, sql`lower(${table.slug})`)
      .where(sql`${table.status} <> 'deleted'`),
    index('projects_team_idx').on(table.teamId),
    index('projects_github_installation_idx').on(table.githubInstallationId),
    index('projects_default_server_idx').on(table.defaultServerId),
  ],
)

export const environments = pgTable(
  'environments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    serverId: text('server_id').references(() => servers.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    branch: text('branch').notNull(),
    isProduction: boolean('is_production').notNull().default(false),
    position: integer('position').notNull().default(0),
    color: text('color').notNull().default('blue'),
    status: environmentStatus('status').notNull().default('active'),
    runtimeId: text('runtime_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('environments_project_slug_idx').on(
      table.projectId,
      table.slug,
    ),
    index('environments_server_idx').on(table.serverId),
  ],
)

export const agentJobs = pgTable(
  'agent_jobs',
  {
    id: text('id').primaryKey(),
    type: agentJobType('type').notNull(),
    status: agentJobStatus('status').notNull().default('queued'),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'restrict' }),
    teamId: text('team_id').references(() => teams.id, {
      onDelete: 'set null',
    }),
    projectId: text('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    payload: jsonb('payload').notNull(),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    errorMessage: text('error_message'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('agent_jobs_server_status_idx').on(table.serverId, table.status),
    index('agent_jobs_project_idx').on(table.projectId),
    index('agent_jobs_team_idx').on(table.teamId),
  ],
)

export const agentRuntimeObservations = pgTable(
  'agent_runtime_observations',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    runtimeId: text('runtime_id').notNull(),
    services: jsonb('services'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    cleanupQueuedAt: timestamp('cleanup_queued_at', { withTimezone: true }),
    purgeQueuedAt: timestamp('purge_queued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_runtime_observations_server_runtime_idx').on(
      table.serverId,
      table.runtimeId,
    ),
    index('agent_runtime_observations_server_idx').on(table.serverId),
    index('agent_runtime_observations_cleanup_idx').on(table.cleanupQueuedAt),
    index('agent_runtime_observations_purge_idx').on(table.purgeQueuedAt),
  ],
)

export const userCleanupJobs = pgTable(
  'user_cleanup_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: userCleanupJobStatus('status').notNull().default('queued'),
    payload: jsonb('payload').notNull(),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    errorMessage: text('error_message'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('user_cleanup_jobs_status_available_idx').on(
      table.status,
      table.availableAt,
    ),
    index('user_cleanup_jobs_user_idx').on(table.userId),
  ],
)

export const backupConfigs = pgTable(
  'backup_configs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    destinationType: backupDestinationType('destination_type')
      .notNull()
      .default('s3'),
    schedule: jsonb('schedule').notNull(),
    destination: jsonb('destination').notNull(),
    retention: jsonb('retention').notNull(),
    volumes: jsonb('volumes')
      .notNull()
      .default({ mode: 'allNamed', names: [] }),
    databaseDumps: jsonb('database_dumps').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('backup_configs_environment_idx').on(table.environmentId),
    index('backup_configs_project_idx').on(table.projectId),
  ],
)

export const deployments = pgTable(
  'deployments',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'restrict' }),
    status: deploymentStatus('status').notNull().default('queued'),
    phase: text('phase'),
    trigger: deploymentTrigger('trigger').notNull().default('user'),
    repoId: bigint('repo_id', { mode: 'number' }).notNull(),
    repoFullName: text('repo_full_name').notNull(),
    gitSha: text('git_sha').notNull(),
    gitBranch: text('git_branch').notNull(),
    commitMeta: jsonb('commit_meta').notNull().default({}),
    config: jsonb('config').notNull(),
    envVars: text('env_vars').notNull(),
    runtimeId: text('runtime_id').notNull(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('deployments_environment_idx').on(table.environmentId),
    index('deployments_server_idx').on(table.serverId),
    index('deployments_status_idx').on(table.status),
    uniqueIndex('deployments_running_runtime_idx')
      .on(table.runtimeId)
      .where(sql`${table.status} = 'running'`),
  ],
)

export const backupRuns = pgTable(
  'backup_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    deploymentId: text('deployment_id').references(() => deployments.id, {
      onDelete: 'set null',
    }),
    serverId: text('server_id').references(() => servers.id, {
      onDelete: 'restrict',
    }),
    runtimeId: text('runtime_id').notNull(),
    status: backupStatus('status').notNull().default('queued'),
    manifest: jsonb('manifest'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    cleanupQueuedAt: timestamp('cleanup_queued_at', { withTimezone: true }),
    cleanupFinishedAt: timestamp('cleanup_finished_at', { withTimezone: true }),
    cleanupErrorMessage: text('cleanup_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('backup_runs_environment_status_idx').on(
      table.environmentId,
      table.status,
    ),
    index('backup_runs_project_idx').on(table.projectId),
    index('backup_runs_deployment_idx').on(table.deploymentId),
    index('backup_runs_cleanup_idx').on(table.cleanupQueuedAt),
  ],
)

export const backupArtifacts = pgTable(
  'backup_artifacts',
  {
    id: text('id').primaryKey(),
    backupRunId: text('backup_run_id')
      .notNull()
      .references(() => backupRuns.id, { onDelete: 'cascade' }),
    type: backupArtifactType('type').notNull(),
    storage: backupArtifactStorage('storage').notNull(),
    objectKey: text('object_key').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('backup_artifacts_run_object_idx').on(
      table.backupRunId,
      table.objectKey,
    ),
    index('backup_artifacts_run_idx').on(table.backupRunId),
  ],
)

export const deploymentLogs = pgTable(
  'deployment_logs',
  {
    deploymentId: text('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    stream: text('stream').notNull(),
    seq: integer('seq').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('deployment_logs_seq_idx').on(
      table.deploymentId,
      table.stream,
      table.seq,
    ),
  ],
)

export const runtimeLogs = pgTable(
  'runtime_logs',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    runtimeId: text('runtime_id').notNull(),
    service: text('service').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('runtime_logs_content_idx').on(
      table.serverId,
      table.runtimeId,
      table.contentHash,
    ),
    index('runtime_logs_runtime_idx').on(table.serverId, table.runtimeId),
    index('runtime_logs_observed_idx').on(table.observedAt),
  ],
)

export const aliases = pgTable(
  'aliases',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    deploymentId: text('deployment_id').references(() => deployments.id, {
      onDelete: 'set null',
    }),
    previousDeploymentId: text('previous_deployment_id').references(
      () => deployments.id,
      { onDelete: 'set null' },
    ),
    hostname: text('hostname').notNull(),
    type: aliasType('type').notNull(),
    branch: text('branch'),
    https: boolean('https').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('aliases_hostname_idx').on(table.hostname),
    index('aliases_project_idx').on(table.projectId),
    index('aliases_environment_idx').on(table.environmentId),
    index('aliases_deployment_idx').on(table.deploymentId),
  ],
)

export const domains = pgTable(
  'domains',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    basePath: text('base_path'),
    https: boolean('https').notNull().default(true),
    status: domainStatus('status').notNull().default('pending'),
    message: text('message'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('domains_hostname_idx').on(table.hostname),
    index('domains_project_idx').on(table.projectId),
    index('domains_environment_idx').on(table.environmentId),
  ],
)
