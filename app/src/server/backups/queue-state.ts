import { backupDestinationSnapshot } from './destination'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import {
  agentJobs,
  backupConfigs,
  backupRuns,
  environments,
  projects,
  servers,
} from '@/server/db/schema'
import type { BackupDestination, BackupJobPayload } from './service'
import type { ApiMutationAdmission } from '@/server/api/admission'

export const backupCleanupRetryDelayMs = 60 * 60 * 1000

// Release reservations before the associated jobs are canceled, in the same
// deletion batch. Match project/server ownership as well as payload run IDs.
export function releaseBackupCleanupRuns(input: {
  jobIds: SQL
  guard: SQL
  message: string
  now: Date
}) {
  return sql`update backup_runs set cleanup_queued_at = null, cleanup_error_message = ${input.message}, updated_at = ${input.now.getTime()}
    where ${input.guard} and exists(select 1 from agent_jobs as cleanup,
      json_each(case when json_valid(cleanup.payload) then cleanup.payload else '{}' end, '$.backupRunIds') as target
      where cleanup.id in (${input.jobIds}) and cleanup.type = 'backup_cleanup' and cleanup.status in ('queued','running')
      and cleanup.server_id = backup_runs.server_id and cleanup.project_id = backup_runs.project_id and target.value = backup_runs.id)`
}

export async function enqueueBackupCleanup(
  store: AtomicStore,
  input: {
    jobId: string
    projectId: string
    serverId: string
    backupRunIds: string[]
    now: Date
    destination: BackupDestination
    artifacts: Array<{
      backupRunId: string
      storage: 'local' | 'remote'
      objectKey: string
    }>
  },
) {
  const now = input.now.getTime()
  // An ID collision must fail even when eligibility would otherwise skip the
  // insert; the following statement must never find an older job with this ID.
  const eligible = sql`select id from ${backupRuns}
    where id in (select value from json_each(${JSON.stringify(input.backupRunIds)}))
      and server_id = ${input.serverId} and project_id = ${input.projectId}
      and exists(select 1 from servers where id = ${input.serverId} and status <> 'deleted')
      and exists(select 1 from projects where id = ${input.projectId} and status = 'active')
      and (cleanup_error_message is null or updated_at <= ${now - backupCleanupRetryDelayMs})
      and (status = 'succeeded' or (status = 'failed' and json_extract(manifest, '$.localRecoveryAvailable') = 1)) and cleanup_queued_at is null`
  const keys = (
    storage: 'local' | 'remote',
  ) => sql`select distinct json_extract(artifact.value, '$.objectKey') as object_key
    from json_each(${JSON.stringify(input.artifacts)}) as artifact
    where json_extract(artifact.value, '$.backupRunId') in (select id from eligible)
      and json_extract(artifact.value, '$.storage') = ${storage} order by object_key`
  const [, marked] = await store.batch([
    store.run(sql`with eligible as materialized (${eligible}), local_keys as (${keys('local')}), remote_keys as (${keys('remote')})
      insert into ${agentJobs} (id, type, status, server_id, project_id, payload, max_attempts, available_at, created_at, updated_at)
      select ${input.jobId}, 'backup_cleanup', 'queued', ${input.serverId}, ${input.projectId},
        json_patch(json_object('schemaVersion', 1, 'backupRunIds', json((select json_group_array(id) from eligible)),
          'localObjectKeys', json((select json_group_array(object_key) from local_keys)),
          'remoteObjectKeys', json((select json_group_array(object_key) from remote_keys)), 'reason', 'Backup retention expired.'),
          case when exists(select 1 from remote_keys) then json_object('destination', json(${JSON.stringify(backupDestinationSnapshot(input.destination))})) else '{}' end),
        5, ${now}, ${now}, ${now} where exists(select 1 from eligible)
          or exists(select 1 from ${agentJobs} where id = ${input.jobId})`),
    store.all(sql`update ${backupRuns} set cleanup_queued_at = ${now}, cleanup_error_message = null, updated_at = ${now}
      where id in (select runtime.value from ${agentJobs} as job, json_each(job.payload, '$.backupRunIds') as runtime where job.id = ${input.jobId})
      returning id`),
  ])
  return marked.map((row) => {
    const id = Array.isArray(row)
      ? row[0]
      : typeof row === 'object' && row !== null && 'id' in row
        ? row.id
        : undefined
    if (typeof id !== 'string')
      throw new Error('Invalid backup cleanup queue result.')
    return id
  })
}

export async function enqueueBackup(
  store: AtomicStore,
  input: {
    backupRunId: string
    agentJobId: string
    configId: string
    projectId: string
    environmentId: string
    deploymentId: string | null
    serverId: string
    runtimeId: string
    scheduleKey: string | null
    manifest: unknown
    payload: BackupJobPayload
    now: Date
    admission?: ApiMutationAdmission
  },
) {
  const now = input.now.getTime()
  // Force a primary-key error for a reused ID instead of letting a skipped
  // insert attach the new job to an older backup run.
  const [created] = await store.batch([
    store.all(sql`insert into ${backupRuns}
      (id, project_id, environment_id, deployment_id, server_id, runtime_id, config_id, schedule_key, status, manifest, destination, created_at, updated_at)
      select ${input.backupRunId}, ${input.projectId}, ${input.environmentId}, ${input.deploymentId},
        ${input.serverId}, ${input.runtimeId}, ${input.configId}, ${input.scheduleKey}, 'queued',
        ${input.manifest == null ? null : JSON.stringify(input.manifest)}, ${input.payload.retention.remote.enabled ? JSON.stringify(backupDestinationSnapshot(input.payload.destination)) : null}, ${now}, ${now}
      where exists(select 1 from ${backupRuns} where id = ${input.backupRunId}) or (
        not exists(select 1 from ${backupRuns} where environment_id = ${input.environmentId} and status in ('queued', 'running'))
        ${input.scheduleKey === null ? sql`` : sql`and not exists(select 1 from ${backupRuns} where environment_id = ${input.environmentId} and schedule_key = ${input.scheduleKey})`}
        and exists(select 1 from ${backupConfigs} as config
          join ${environments} as env on env.id = config.environment_id
          join ${projects} as project on project.id = env.project_id
          join ${servers} as server on server.id = coalesce(env.server_id, project.default_server_id)
          where config.id = ${input.configId} and config.enabled = 1 and env.id = ${input.environmentId}
            and project.id = ${input.projectId} and env.status = 'active' and project.status = 'active'
            and server.id = ${input.serverId} and server.status in ('connected', 'disconnected'))
        and ${input.admission?.guard ?? sql`1`}) returning id`),
    store.run(sql`insert into ${agentJobs}
      (id, type, status, server_id, project_id, payload, max_attempts, available_at, created_at, updated_at)
      select ${input.agentJobId}, 'backup', 'queued', server_id, project_id,
        ${JSON.stringify({ ...input.payload, destination: backupDestinationSnapshot(input.payload.destination) })}, 5, ${now}, ${now}, ${now}
      from ${backupRuns} where id = ${input.backupRunId}`),
    ...(input.admission?.statements ?? []),
  ])
  return created.length === 1
}
