import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import { agentJobs, backupArtifacts, backupRuns } from '@/server/db/schema'
import type {
  AgentBackupCompletion,
  AgentBackupCleanupCompletion,
} from './protocol'

function runningJob(
  jobId: string,
  serverId: string,
  type: 'backup' | 'backup_cleanup',
) {
  return sql`exists(select 1 from ${agentJobs} where id = ${jobId} and server_id = ${serverId}
    and type = ${type} and status = 'running')`
}

export async function failStaleAgentJob(
  store: AtomicStore,
  input: {
    job: typeof agentJobs.$inferSelect
    payloadSnapshot: string
    now: Date
    timeoutMs: number
    message: string
    backupRunId: string | null
    cleanupRunIds: string[]
  },
) {
  const now = input.now.getTime()
  const guard = sql`id = ${input.job.id} and server_id = ${input.job.serverId}
    and type = ${input.job.type} and payload = ${input.payloadSnapshot} and status = ${input.job.status}
    and attempt = ${input.job.attempt} and updated_at = ${input.job.updatedAt.getTime()}
    and ((status = 'running' and (claimed_at is null or claimed_at < ${now - input.timeoutMs}))
      or (status = 'queued' and available_at < ${now - input.timeoutMs}))`
  const eligible = sql`exists(select 1 from ${agentJobs} where ${guard})`
  const effects = []
  if (input.backupRunId) {
    effects.push(
      store.run(sql`update ${backupRuns} set status = 'failed', error_message = ${input.message},
      finished_at = ${now}, updated_at = ${now} where id = ${input.backupRunId}
      and server_id = ${input.job.serverId} and status = ${input.job.status} and ${eligible}`),
    )
  }
  for (let offset = 0; offset < input.cleanupRunIds.length; offset += 80) {
    effects.push(
      store.run(sql`update ${backupRuns} set cleanup_queued_at = null,
      cleanup_error_message = ${input.message}, updated_at = ${now}
      where id in (select value from json_each(${JSON.stringify(input.cleanupRunIds.slice(offset, offset + 80))}))
      and server_id = ${input.job.serverId} and ${eligible}`),
    )
  }
  const finish =
    store.all(sql`update ${agentJobs} set status = 'failed', error_message = ${input.message},
    finished_at = ${now}, updated_at = ${now} where ${guard} returning id`)
  const [first, ...rest] = effects
  if (!first) return (await finish).length === 1
  const results = await store.batch([first, ...rest, finish])
  const completed = results.at(-1)
  return Array.isArray(completed) && completed.length === 1
}

export async function finishBackup(
  store: AtomicStore,
  input: {
    serverId: string
    completion: AgentBackupCompletion
    errorMessage: string | null
    now: Date
    manifest: unknown
  },
) {
  const { completion } = input
  const now = input.now.getTime()
  const guard = runningJob(completion.jobId, input.serverId, 'backup')
  const artifactGuard = sql`${guard} and exists(select 1 from ${backupRuns}
    where id = ${completion.backupRunId} and server_id = ${input.serverId} and status = 'running')`
  const artifacts =
    completion.status === 'succeeded'
      ? (completion.artifacts ?? [])
      : completion.status === 'failed' &&
          typeof input.manifest === 'object' &&
          input.manifest !== null &&
          'localRecoveryAvailable' in input.manifest &&
          input.manifest.localRecoveryAvailable === true
        ? (completion.artifacts ?? []).filter(
            (artifact) => artifact.storage === 'local',
          )
        : []
  const inserts = []
  for (let offset = 0; offset < artifacts.length; offset += 8) {
    const rows = artifacts.slice(offset, offset + 8).map(
      (artifact) =>
        sql`(${crypto.randomUUID()}, ${completion.backupRunId}, ${artifact.type}, ${artifact.storage},
          ${artifact.objectKey}, ${artifact.checksumSha256}, ${artifact.sizeBytes}, ${now})`,
    )
    inserts.push(
      store.run(sql`insert into ${backupArtifacts} (id, backup_run_id, type, storage, object_key, checksum_sha256, size_bytes, created_at)
      select column1, column2, column3, column4, column5, column6, column7, column8
      from (values ${sql.join(rows, sql`, `)}) where ${artifactGuard}
      on conflict(backup_run_id, object_key) do nothing`),
    )
  }
  const patch =
    store.run(sql`update ${backupRuns} set status = ${completion.status},
    manifest = json_set(json_patch(coalesce(manifest, '{}'), ${JSON.stringify(input.manifest ?? {})}), '$.databaseTargets', json(coalesce(json_extract(manifest, '$.databaseTargets'), '[]'))), error_message = ${input.errorMessage},
    started_at = coalesce(started_at, ${now}), finished_at = ${now}, updated_at = ${now}
    where id = ${completion.backupRunId} and server_id = ${input.serverId} and status = 'running' and ${guard}`)
  const finish =
    store.all(sql`update ${agentJobs} set status = ${completion.status}, error_message = ${input.errorMessage},
    finished_at = ${now}, updated_at = ${now} where id = ${completion.jobId} and server_id = ${input.serverId}
    and type = 'backup' and status = 'running' returning id`)
  const [first, ...rest] = inserts
  const results = first
    ? await store.batch([first, ...rest, patch, finish])
    : await store.batch([patch, finish])
  const completed = results.at(-1)
  return Array.isArray(completed) && completed.length === 1
}

export async function finishBackupCleanup(
  store: AtomicStore,
  input: {
    serverId: string
    completion: AgentBackupCleanupCompletion
    errorMessage: string | null
    now: Date
    backupRunIds: string[]
    localObjectKeys: string[]
    remoteObjectKeys: string[]
  },
) {
  const now = input.now.getTime()
  const { completion } = input
  const guard = runningJob(completion.jobId, input.serverId, 'backup_cleanup')
  const deletes = []
  if (completion.status === 'succeeded') {
    for (const [storage, keys] of [
      ['local', input.localObjectKeys],
      ['remote', input.remoteObjectKeys],
    ] as const) {
      for (let offset = 0; offset < keys.length; offset += 80) {
        deletes.push(
          store.run(sql`delete from ${backupArtifacts}
          where backup_run_id in (select value from json_each(${JSON.stringify(input.backupRunIds)}))
          and storage = ${storage} and object_key in (select value from json_each(${JSON.stringify(keys.slice(offset, offset + 80))}))
          and ${guard} and exists(select 1 from ${backupRuns} as run
            where run.id = ${backupArtifacts.backupRunId} and run.server_id = ${input.serverId})`),
        )
      }
    }
  }
  const patches = []
  for (let offset = 0; offset < input.backupRunIds.length; offset += 80) {
    patches.push(
      store.run(sql`update ${backupRuns} set cleanup_queued_at = null,
      cleanup_error_message = ${input.errorMessage}, updated_at = ${now}
      ${completion.status === 'succeeded' ? sql`, cleanup_finished_at = ${now}` : sql``}
      where id in (select value from json_each(${JSON.stringify(input.backupRunIds.slice(offset, offset + 80))}))
      and server_id = ${input.serverId} and ${guard}`),
    )
  }
  const finish =
    store.all(sql`update ${agentJobs} set status = ${completion.status}, error_message = ${input.errorMessage},
    finished_at = ${now}, updated_at = ${now} where id = ${completion.jobId} and server_id = ${input.serverId}
    and type = 'backup_cleanup' and status = 'running' returning id`)
  const [first, ...rest] = [...deletes, ...patches]
  if (!first) return (await finish).length === 1
  const results = await store.batch([first, ...rest, finish])
  const completed = results.at(-1)
  return Array.isArray(completed) && completed.length === 1
}

export async function failClaimedAgentJob(
  store: AtomicStore,
  input: {
    job: typeof agentJobs.$inferSelect
    now: Date
    message: string
    backupRunId: string | null
    cleanupRunIds: string[]
  },
) {
  const job = input.job,
    now = input.now.getTime()
  const guard = sql`id = ${job.id} and server_id = ${job.serverId} and type = ${job.type} and status = 'running'
    and attempt = ${job.attempt} and claimed_at is ${job.claimedAt?.getTime() ?? null} and updated_at = ${job.updatedAt.getTime()}`
  const eligible = sql`exists(select 1 from agent_jobs where ${guard})`
  const effects = []
  if (input.backupRunId)
    effects.push(
      store.run(sql`update backup_runs set status = 'failed', error_message = ${input.message}, finished_at = ${now}, updated_at = ${now}
    where id = ${input.backupRunId} and project_id = ${job.projectId} and server_id = ${job.serverId} and status = 'running' and ${eligible}`),
    )
  if (input.cleanupRunIds.length)
    effects.push(
      store.run(sql`update backup_runs set cleanup_queued_at = null, cleanup_error_message = ${input.message}, updated_at = ${now}
    where id in (select value from json_each(${JSON.stringify(input.cleanupRunIds)})) and project_id = ${job.projectId} and server_id = ${job.serverId} and ${eligible}`),
    )
  const finish = store.run(
    sql`update agent_jobs set status = 'failed', error_message = ${input.message}, finished_at = ${now}, updated_at = ${now} where ${guard}`,
  )
  const [first, ...rest] = effects
  if (first) await store.batch([first, ...rest, finish])
  else await finish
}
