import { getTableName, sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'

export * from './oauth-schema'

function enumColumn<const T extends readonly [string, ...string[]]>(values: T) {
  return (name: string) => text(name, { enum: values })
}

function enumChecks(table: Record<string, SQLiteColumn>) {
  return Object.values(table).flatMap((column) =>
    column.enumValues?.length
      ? [
          check(
            `${getTableName(column.table)}_${column.name}_enum`,
            sql`${column} in (${sql.join(
              column.enumValues.map((value) => sql`${value}`),
              sql`, `,
            )})`.inlineParams(),
          ),
        ]
      : [],
  )
}

export const teamMemberRole = enumColumn(['owner', 'admin', 'member'])

export const teamInviteStatus = enumColumn([
  'pending',
  'accepted',
  'revoked',
  'expired',
])

export const serverStatus = enumColumn([
  'pending',
  'connected',
  'disconnected',
  'disabled',
  'deleted',
])

export const githubInstallationStatus = enumColumn([
  'active',
  'deleted',
  'suspended',
])

export const deploymentStatus = enumColumn([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
])

export const deploymentTrigger = enumColumn([
  'user',
  'webhook',
  'api',
  'rollback',
])

export const environmentStatus = enumColumn(['active', 'deleted'])

export const aliasType = enumColumn(['deployment', 'environment', 'branch'])

export const domainStatus = enumColumn([
  'pending',
  'active',
  'disabled',
  'failed',
])

export const resourceStatus = enumColumn(['active', 'deleted', 'banned'])

export const allowlistType = enumColumn(['email', 'domain', 'pattern'])

export const agentJobType = enumColumn([
  'deploy',
  'deprovision',
  'purge',
  'backup',
  'restore',
  'backup_cleanup',
])

export const agentJobStatus = enumColumn([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'abandoned',
])

export const userCleanupJobStatus = enumColumn([
  'queued',
  'running',
  'succeeded',
  'failed',
])

export const backupDestinationType = enumColumn(['s3'])

export const backupStatus = enumColumn([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
])

export const backupArtifactType = enumColumn(['manifest', 'volume', 'database'])

export const backupArtifactStorage = enumColumn(['local', 'remote'])

export const teams = sqliteTable(
  'teams',
  {
    id: text('id').primaryKey(),
    settingsVersion: integer('settings_version').notNull().default(1),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: resourceStatus('status').notNull().default('active'),
    avatarPath: text('avatar_path'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('teams_slug_idx').on(table.slug),
  ],
)

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    settingsVersion: integer('settings_version').notNull().default(1),
    profileConfirmedAt: integer('profile_confirmed_at', {
      mode: 'timestamp_ms',
    }),
    name: text('name').notNull(),
    username: text('username').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' })
      .notNull()
      .default(false),
    status: resourceStatus('status').notNull().default('active'),
    image: text('image'),
    defaultTeamId: text('default_team_id').references(() => teams.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('user_username_idx')
      .on(sql`lower(${table.username})`)
      .where(sql`status = 'active'`),
  ],
)

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    ...enumChecks(table),
    index('session_user_id_idx').on(table.userId),
  ],
)

export const account = sqliteTable(
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
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    providerAccountName: text('provider_account_name'),
    providerAccountEmail: text('provider_account_email'),
    providerAccountUsername: text('provider_account_username'),
    providerAccountImage: text('provider_account_image'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    ...enumChecks(table),
    index('account_user_id_idx').on(table.userId),
    index('account_provider_identity_idx').on(
      table.providerId,
      table.accountId,
    ),
  ],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    ...enumChecks(table),
    index('verification_identifier_idx').on(table.identifier),
  ],
)

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: integer('reset_at', { mode: 'timestamp_ms' }).notNull(),
})

export const allowlist = sqliteTable(
  'allowlist',
  {
    id: text('id').primaryKey(),
    type: allowlistType('type').notNull(),
    value: text('value').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    ...enumChecks(table),
    index('allowlist_type_idx').on(table.type),
    uniqueIndex('allowlist_type_value_idx').on(
      table.type,
      sql`lower(${table.value})`,
    ),
  ],
)

export const teamMembers = sqliteTable(
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('team_members_team_user_idx').on(table.teamId, table.userId),
    index('team_members_user_idx').on(table.userId),
    index('team_members_team_idx').on(table.teamId),
  ],
)

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    membershipId: text('membership_id')
      .notNull()
      .references(() => teamMembers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    roleCeiling: teamMemberRole('role_ceiling').notNull(),
    preset: text('preset', { enum: ['read', 'deploy', 'manage'] }).notNull(),
    projectIds: text('project_ids', {
      mode: 'json',
    }).$type<Array<string> | null>(),
    scopes: text('scopes', { mode: 'json' }).notNull().$type<Array<string>>(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('api_keys_hash_idx').on(table.keyHash),
    index('api_keys_user_idx').on(table.userId),
    index('api_keys_membership_idx').on(table.membershipId),
  ],
)

export const apiGrants = sqliteTable(
  'api_grants',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    membershipId: text('membership_id')
      .notNull()
      .references(() => teamMembers.id, { onDelete: 'cascade' }),
    roleCeiling: teamMemberRole('role_ceiling').notNull(),
    projectIds: text('project_ids', {
      mode: 'json',
    }).$type<Array<string> | null>(),
    scopes: text('scopes', { mode: 'json' }).notNull().$type<Array<string>>(),
    providerGrantId: text('provider_grant_id'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('api_grants_user_idx').on(table.userId),
    index('api_grants_membership_idx').on(table.membershipId),
  ],
)

export const apiAudit = sqliteTable(
  'api_audit',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull(),
    userId: text('user_id').notNull(),
    credentialId: text('credential_id').notNull(),
    requestId: text('request_id').notNull(),
    operation: text('operation').notNull(),
    resourceId: text('resource_id').notNull(),
    outcome: text('outcome').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    index('api_audit_team_created_idx').on(table.teamId, table.createdAt),
    index('api_audit_created_idx').on(table.createdAt),
  ],
)

export const apiIdempotency = sqliteTable(
  'api_idempotency',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => teamMembers.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull(),
    operation: text('operation').notNull(),
    resourceId: text('resource_id').notNull(),
    keyHash: text('key_hash').notNull(),
    requestHash: text('request_hash').notNull(),
    response: text('response', { mode: 'json' }).notNull().$type<unknown>(),
    statusCode: integer('status_code').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('api_idempotency_actor_operation_key_idx').on(
      table.membershipId,
      table.operation,
      table.resourceId,
      table.keyHash,
    ),
    index('api_idempotency_expiry_idx').on(table.expiresAt),
  ],
)

export const teamInvites = sqliteTable(
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
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('team_invites_token_hash_idx').on(table.tokenHash),
    uniqueIndex('team_invites_pending_email_idx')
      .on(table.teamId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending'`),
    index('team_invites_team_idx').on(table.teamId),
    index('team_invites_email_idx').on(sql`lower(${table.email})`),
  ],
)

export const githubInstallations = sqliteTable(
  'github_installations',
  {
    installationId: integer('installation_id').primaryKey(),
    accountId: integer('account_id'),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    repositorySelection: text('repository_selection').notNull(),
    status: githubInstallationStatus('status').notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('github_installations_account_id_idx').on(table.accountId),
    index('github_installations_account_idx').on(table.accountLogin),
    index('github_installations_status_idx').on(table.status),
  ],
)

export const servers = sqliteTable(
  'servers',
  {
    id: text('id').primaryKey(),
    settingsVersion: integer('settings_version').notNull().default(1),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    handle: text('handle').notNull(),
    status: serverStatus('status').notNull().default('pending'),
    agentVersion: text('agent_version'),
    agentProtocolVersion: integer('agent_protocol_version'),
    agentCapabilities: text('agent_capabilities', { mode: 'json' }).$type<
      Array<string>
    >(),
    publicAddress: text('public_address'),
    publicIpv4: text('public_ipv4'),
    publicIpv6: text('public_ipv6'),
    hostname: text('hostname'),
    operatingSystem: text('operating_system'),
    kernelVersion: text('kernel_version'),
    architecture: text('architecture'),
    cpuCoreCount: integer('cpu_core_count'),
    hostUptimeSeconds: integer('host_uptime_seconds'),
    enrollmentTokenHash: text('enrollment_token_hash'),
    enrollmentTokenExpiresAt: integer('enrollment_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    agentCredentialHash: text('agent_credential_hash'),
    pendingAgentCredentialHash: text('pending_agent_credential_hash'),
    agentCredentialRotatedAt: integer('agent_credential_rotated_at', {
      mode: 'timestamp_ms',
    }),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('servers_team_handle_idx')
      .on(table.teamId, table.handle)
      .where(sql`${table.status} <> 'deleted'`),
    uniqueIndex('servers_team_name_idx')
      .on(table.teamId, sql`lower(${table.name})`)
      .where(sql`${table.status} <> 'deleted'`),
    index('servers_team_idx').on(table.teamId),
    index('servers_agent_credential_idx')
      .on(table.agentCredentialHash)
      .where(sql`${table.agentCredentialHash} is not null`),
    index('servers_pending_agent_credential_idx')
      .on(table.pendingAgentCredentialHash)
      .where(sql`${table.pendingAgentCredentialHash} is not null`),
    index('servers_enrollment_token_idx')
      .on(table.enrollmentTokenHash)
      .where(sql`${table.enrollmentTokenHash} is not null`),
  ],
)

export const serverHeartbeats = sqliteTable(
  'server_heartbeats',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
    lastObservedAt: integer('last_observed_at', { mode: 'timestamp_ms' }),
    agentVersion: text('agent_version'),
    publicAddress: text('public_address'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('server_heartbeats_server_observed_idx').on(
      table.serverId,
      table.observedAt,
    ),
    index('server_heartbeats_observed_idx').on(table.observedAt),
  ],
)

export const serverAvailabilityWindows = sqliteTable(
  'server_availability_windows',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('server_availability_windows_server_started_idx').on(
      table.serverId,
      table.startedAt,
    ),
  ],
)

export const serverMetrics = sqliteTable(
  'server_metrics',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
    cpuPercent: real('cpu_percent'),
    load1: real('load_1'),
    memoryUsedBytes: integer('memory_used_bytes'),
    memoryTotalBytes: integer('memory_total_bytes'),
    diskUsedBytes: integer('disk_used_bytes'),
    diskTotalBytes: integer('disk_total_bytes'),
    networkReceiveBytesPerSecond: real('network_receive_bytes_per_second'),
    networkTransmitBytesPerSecond: real('network_transmit_bytes_per_second'),
    diskReadBytesPerSecond: real('disk_read_bytes_per_second'),
    diskWriteBytesPerSecond: real('disk_write_bytes_per_second'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('server_metrics_server_observed_idx').on(
      table.serverId,
      table.observedAt,
    ),
    index('server_metrics_observed_idx').on(table.observedAt),
  ],
)

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    settingsVersion: integer('settings_version').notNull().default(1),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: resourceStatus('status').notNull().default('active'),
    githubRepoId: integer('github_repo_id'),
    githubRepo: text('github_repo').notNull(),
    githubInstallationId: integer('github_installation_id').references(
      () => githubInstallations.installationId,
      {
        onDelete: 'restrict',
      },
    ),
    defaultServerId: text('default_server_id').references(() => servers.id, {
      onDelete: 'restrict',
    }),
    avatarPath: text('avatar_path'),
    routes: text('routes', { mode: 'json' }),
    envVarsEncrypted: text('env_vars_encrypted'),
    runtimeConfig: text('runtime_config', { mode: 'json' })
      .notNull()
      .default(
        sql`'{"type":"compose","path":null,"releaseCommand":null,"releaseService":null,"readinessPath":null,"deployCommand":null,"rollbackCommand":null,"timeoutSeconds":1800}'`,
      ),
    composeMetadata: text('compose_metadata', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('projects_team_slug_idx')
      .on(table.teamId, sql`lower(${table.slug})`)
      .where(sql`${table.status} <> 'deleted'`),
    index('projects_team_idx').on(table.teamId),
    index('projects_github_installation_idx').on(table.githubInstallationId),
    index('projects_default_server_idx').on(table.defaultServerId),
  ],
)

export const environments = sqliteTable(
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
    isProduction: integer('is_production', { mode: 'boolean' })
      .notNull()
      .default(false),
    position: integer('position').notNull().default(0),
    color: text('color').notNull().default('blue'),
    status: environmentStatus('status').notNull().default('active'),
    runtimeId: text('runtime_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('environments_project_slug_idx').on(
      table.projectId,
      table.slug,
    ),
    index('environments_server_idx').on(table.serverId),
  ],
)

export const agentJobs = sqliteTable(
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
    payload: text('payload', { mode: 'json' }).notNull(),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    errorMessage: text('error_message'),
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    availableAt: integer('available_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('agent_jobs_server_status_idx').on(table.serverId, table.status),
    index('agent_jobs_project_idx').on(table.projectId),
    index('agent_jobs_team_idx').on(table.teamId),
  ],
)

export const agentRuntimeObservations = sqliteTable(
  'agent_runtime_observations',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    runtimeId: text('runtime_id').notNull(),
    services: text('services', { mode: 'json' }),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    orphanedAt: integer('orphaned_at', { mode: 'timestamp_ms' }),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    cleanupQueuedAt: integer('cleanup_queued_at', { mode: 'timestamp_ms' }),
    purgeQueuedAt: integer('purge_queued_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('agent_runtime_observations_server_runtime_idx').on(
      table.serverId,
      table.runtimeId,
    ),
    index('agent_runtime_observations_server_idx').on(table.serverId),
    index('agent_runtime_observations_cleanup_idx').on(table.cleanupQueuedAt),
    index('agent_runtime_observations_purge_idx').on(table.purgeQueuedAt),
  ],
)

export const userCleanupJobs = sqliteTable(
  'user_cleanup_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: userCleanupJobStatus('status').notNull().default('queued'),
    payload: text('payload', { mode: 'json' }).notNull(),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    errorMessage: text('error_message'),
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    availableAt: integer('available_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('user_cleanup_jobs_status_available_idx').on(
      table.status,
      table.availableAt,
    ),
    index('user_cleanup_jobs_user_idx').on(table.userId),
  ],
)

export const backupStorage = sqliteTable(
  'backup_storage',
  {
    id: text('id').primaryKey(),
    settingsVersion: integer('settings_version').notNull().default(1),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    bucket: text('bucket').notNull(),
    region: text('region').notNull(),
    endpoint: text('endpoint'),
    accessKeyId: text('access_key_id').notNull(),
    secretAccessKeyCiphertext: text('secret_access_key_ciphertext').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [index('backup_storage_team_idx').on(table.teamId)],
)

export const backupConfigs = sqliteTable(
  'backup_configs',
  {
    id: text('id').primaryKey(),
    settingsVersion: integer('settings_version').notNull().default(1),
    name: text('name').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    destinationType: backupDestinationType('destination_type')
      .notNull()
      .default('s3'),
    schedule: text('schedule', { mode: 'json' }).notNull(),
    nextCheckAt: integer('next_check_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`0`),
    destination: text('destination', { mode: 'json' }).notNull(),
    retention: text('retention', { mode: 'json' }).notNull(),
    volumes: text('volumes', { mode: 'json' })
      .notNull()
      .default({ mode: 'allNamed', names: [] }),
    databaseDumps: text('database_dumps', { mode: 'json' })
      .notNull()
      .default([]),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('backup_configs_due_idx').on(table.enabled, table.nextCheckAt),
    index('backup_configs_environment_idx').on(table.environmentId),
    index('backup_configs_project_idx').on(table.projectId),
  ],
)

export const deployments = sqliteTable(
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
    githubDeliveryId: text('github_delivery_id'),
    repoId: integer('repo_id').notNull(),
    repoFullName: text('repo_full_name').notNull(),
    gitSha: text('git_sha').notNull(),
    gitBranch: text('git_branch').notNull(),
    commitMeta: text('commit_meta', { mode: 'json' }).notNull().default({}),
    config: text('config', { mode: 'json' }).notNull(),
    envVars: text('env_vars').notNull(),
    runtimeId: text('runtime_id').notNull(),
    errorMessage: text('error_message'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('deployments_environment_idx').on(table.environmentId),
    index('deployments_server_status_idx').on(table.serverId, table.status),
    index('deployments_status_idx').on(table.status),
    uniqueIndex('deployments_running_runtime_idx')
      .on(table.runtimeId)
      .where(sql`${table.status} = 'running'`),
    uniqueIndex('deployments_github_delivery_environment_idx')
      .on(table.githubDeliveryId, table.environmentId)
      .where(sql`${table.githubDeliveryId} is not null`),
  ],
)

export const backupRuns = sqliteTable(
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
    configId: text('config_id'),
    scheduleKey: text('schedule_key'),
    status: backupStatus('status').notNull().default('queued'),
    manifest: text('manifest', { mode: 'json' }),
    destination: text('destination', { mode: 'json' }),
    errorMessage: text('error_message'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    cleanupQueuedAt: integer('cleanup_queued_at', { mode: 'timestamp_ms' }),
    cleanupFinishedAt: integer('cleanup_finished_at', { mode: 'timestamp_ms' }),
    cleanupErrorMessage: text('cleanup_error_message'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    index('backup_runs_environment_status_idx').on(
      table.environmentId,
      table.status,
    ),
    index('backup_runs_project_idx').on(table.projectId),
    index('backup_runs_deployment_idx').on(table.deploymentId),
    index('backup_runs_cleanup_idx').on(table.cleanupQueuedAt),
    uniqueIndex('backup_runs_environment_schedule_idx')
      .on(table.environmentId, table.scheduleKey)
      .where(sql`${table.scheduleKey} is not null`),
    uniqueIndex('backup_runs_active_environment_idx')
      .on(table.environmentId)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
)

export const backupArtifacts = sqliteTable(
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
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('backup_artifacts_run_object_idx').on(
      table.backupRunId,
      table.objectKey,
    ),
    index('backup_artifacts_run_idx').on(table.backupRunId),
  ],
)

export const deploymentEvents = sqliteTable(
  'deployment_events',
  {
    deploymentId: text('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    stream: text('stream').notNull(),
    seq: integer('seq').notNull(),
    content: text('content').notNull(),
    searchContent: text('search_content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('deployment_events_seq_idx').on(
      table.deploymentId,
      table.stream,
      table.seq,
    ),
  ],
)

export const aliases = sqliteTable(
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
    https: integer('https', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('aliases_hostname_idx').on(table.hostname),
    index('aliases_project_idx').on(table.projectId),
    index('aliases_environment_idx').on(table.environmentId),
    index('aliases_deployment_idx').on(table.deploymentId),
  ],
)

export const domains = sqliteTable(
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
    https: integer('https', { mode: 'boolean' }).notNull().default(true),
    status: domainStatus('status').notNull().default('pending'),
    message: text('message'),
    verifiedAt: integer('verified_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    ...enumChecks(table),
    uniqueIndex('domains_hostname_idx').on(table.hostname),
    index('domains_project_idx').on(table.projectId),
    index('domains_environment_idx').on(table.environmentId),
  ],
)

export const notificationPreferences = sqliteTable('notification_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  preferences: text('preferences', { mode: 'json' })
    .notNull()
    .$type<Record<string, boolean>>(),
  version: integer('version').notNull().default(1),
})

export const notificationMutes = sqliteTable(
  'notification_mutes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => [
    index('notification_mutes_user_scope_idx').on(
      table.userId,
      table.teamId,
      table.projectId,
    ),
  ],
)

export const notificationIncidents = sqliteTable('notification_incidents', {
  id: text('id').primaryKey(),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, {
    onDelete: 'cascade',
  }),
  category: text('category').notNull(),
  sourceId: text('source_id').notNull(),
  revision: text('revision').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  actorId: text('actor_id'),
  title: text('title').notNull(),
  message: text('message').notNull(),
  path: text('path').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const notificationOutbox = sqliteTable(
  'notification_outbox',
  {
    id: text('id').primaryKey(),
    incidentId: text('incident_id')
      .notNull()
      .references(() => notificationIncidents.id, { onDelete: 'cascade' }),
    payload: text('payload', { mode: 'json' }).notNull().$type<{
      from: string
      to: string
      subject: string
      text: string
      html: string
    }>(),
    revision: text('revision').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    actor: integer('actor', { mode: 'boolean' }).notNull().default(false),
    recovery: integer('recovery', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
    firstAttemptAt: integer('first_attempt_at'),
    deliveredAt: integer('delivered_at'),
    discardedAt: integer('discarded_at'),
    failedAt: integer('failed_at'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull().default(0),
    leaseOwner: text('lease_owner'),
    leaseUntil: integer('lease_until').notNull().default(0),
  },
  (table) => [
    uniqueIndex('notification_outbox_event_recipient_idx').on(
      table.incidentId,
      table.revision,
      table.userId,
      table.recovery,
    ),
    index('notification_outbox_due_idx').on(
      table.deliveredAt,
      table.discardedAt,
      table.failedAt,
      table.nextAttemptAt,
    ),
  ],
)

export const notificationScanCursors = sqliteTable(
  'notification_scan_cursors',
  {
    source: text('source').primaryKey(),
    afterId: text('after_id').notNull(),
  },
)
