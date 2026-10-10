import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)

export const logCleanupPositions = sqliteTable('log_cleanup_positions', {
  id: text('id').primaryKey(),
  cursor: text('cursor'),
})

// Identity is verified against the main database at ingestion and authorization
// is checked there on every read. Foreign keys cannot cross database files.
export const deploymentLogs = sqliteTable(
  'deployment_logs',
  {
    projectId: text('project_id').notNull(),
    environmentId: text('environment_id').notNull(),
    deploymentId: text('deployment_id').notNull(),
    serverId: text('server_id').notNull(),
    branch: text('branch').notNull(),
    stream: text('stream').notNull(),
    seq: integer('seq').notNull(),
    content: text('content').notNull(),
    searchContent: text('search_content').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('deployment_logs_deployment_stream_seq_idx').on(
      table.deploymentId,
      table.stream,
      table.seq,
    ),
    index('deployment_logs_project_time_idx').on(
      table.projectId,
      table.createdAt,
    ),
    index('deployment_logs_project_environment_time_idx').on(
      table.projectId,
      table.environmentId,
      table.createdAt,
    ),
  ],
)

export const runtimeLogs = sqliteTable(
  'runtime_logs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    environmentId: text('environment_id').notNull(),
    serverId: text('server_id').notNull(),
    runtimeId: text('runtime_id').notNull(),
    service: text('service').notNull(),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
    content: text('content').notNull(),
    searchContent: text('search_content').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('runtime_logs_hash_idx').on(
      table.serverId,
      table.runtimeId,
      table.contentHash,
    ),
    index('runtime_logs_project_time_idx').on(
      table.projectId,
      table.observedAt,
    ),
    index('runtime_logs_server_runtime_time_idx').on(
      table.serverId,
      table.runtimeId,
      table.observedAt,
    ),
    index('runtime_logs_observed_at_idx').on(table.observedAt),
  ],
)
