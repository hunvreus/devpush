import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AtomicStore } from './db/atomic'
import { runtimeCleanupInsert } from './agents/cleanup'

export type RecoveryAction =
  | 'retry-job'
  | 'confirm-job'
  | 'cleanup-project'
  | 'confirm-artifact'
export type RecoveryTarget = 'project' | 'server' | 'team' | 'job' | 'artifact'
type Row = Record<string, unknown>

export class RecoveryInputError extends Error {}

export function recoveryRows(rows: unknown[]): Row[] {
  return rows.map((row) => {
    const encoded = Array.isArray(row)
      ? row[0]
      : row && typeof row === 'object' && 'record' in row
        ? row.record
        : undefined
    if (typeof encoded === 'string') return JSON.parse(encoded) as Row
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new RecoveryInputError('Recovery requires named database results.')
    return row as Row
  })
}

export function listDeletedResourcesQuery() {
  return jsonRows(
    sql`select 'project' as target, id, name, updated_at from projects where status = 'deleted'
    union all select 'team', id, name, updated_at from teams where status = 'deleted'
    union all select 'server', id, name, updated_at from servers where status = 'deleted'
    order by updated_at, target, id limit 101`,
    ['target', 'id', 'name', 'updated_at'],
  )
}

export function recoveryTargetQuery(target: RecoveryTarget, id: string) {
  const table = {
    project: 'projects',
    server: 'servers',
    team: 'teams',
    job: 'agent_jobs',
    artifact: 'backup_artifacts',
  }[target]
  const fields =
    target === 'job'
      ? [
          'id',
          'type',
          'status',
          'server_id',
          'team_id',
          'project_id',
          'payload',
          'attempt',
          'max_attempts',
          'updated_at',
          'claimed_at',
          'available_at',
        ]
      : target === 'artifact'
        ? ['id', 'backup_run_id', 'storage', 'object_key', 'checksum_sha256']
        : target === 'team'
          ? ['id', 'status', 'updated_at']
          : ['id', 'status', 'updated_at', 'team_id']
  return jsonRows(sql`select * from ${sql.raw(table)} where id = ${id}`, fields)
}

function jsonRows(query: SQL, fields: string[]) {
  return sql`select json_object(${sql.join(
    fields.flatMap((field) => [sql`${field}`, sql.raw(field)]),
    sql`, `,
  )}) as record from (${query})`
}

// Whitelist output: job payloads and resource rows can contain credentials.
export async function inspectDeletion(
  store: AtomicStore,
  target: RecoveryTarget,
  row: Row,
) {
  const id = String(row.id)
  const projectIds =
    target === 'project'
      ? sql`select id from projects where id = ${id}`
      : target === 'team'
        ? sql`select id from projects where team_id = ${id}`
        : target === 'server'
          ? sql`select id from projects where default_server_id = ${id}
      union select project_id from environments where server_id = ${id}
      union select project_id from deployments where server_id = ${id}`
          : sql`select null where 0`
  const jobs = await store.all(
    jsonRows(
      sql`select id, type, status, attempt, max_attempts, server_id, project_id,
    available_at, claimed_at, updated_at, json_extract(payload, '$.runtimeIds') as runtime_ids,
    json_extract(payload, '$.backupRunIds') as backup_run_ids, json_extract(payload, '$.localObjectKeys') as local_object_keys,
    json_extract(payload, '$.remoteObjectKeys') as remote_object_keys, json_extract(payload, '$.operatorResolution') as resolution from agent_jobs where
    ${target === 'job' ? sql`id = ${id}` : target === 'server' ? sql`server_id = ${id}` : target === 'team' ? sql`team_id = ${id} or project_id in (${projectIds})` : sql`project_id in (${projectIds}) or (project_id is null and team_id = ${row.team_id ?? null})`}
    order by id limit 101`,
      [
        'id',
        'type',
        'status',
        'attempt',
        'max_attempts',
        'server_id',
        'project_id',
        'available_at',
        'claimed_at',
        'updated_at',
        'runtime_ids',
        'backup_run_ids',
        'local_object_keys',
        'remote_object_keys',
        'resolution',
      ],
    ),
  )
  const artifacts = await store.all(
    jsonRows(
      sql`select a.id, a.backup_run_id, a.storage, a.object_key, a.checksum_sha256,
    a.size_bytes, r.project_id, r.server_id, json_extract(r.destination, '$.bucket') as bucket,
    json_extract(r.destination, '$.storageId') as storage_id from backup_artifacts a join backup_runs r on r.id = a.backup_run_id
    where ${target === 'artifact' ? sql`a.id = ${id}` : target === 'server' ? sql`r.server_id = ${id}` : sql`r.project_id in (${projectIds})`}
    order by a.id limit 101`,
      [
        'id',
        'backup_run_id',
        'storage',
        'object_key',
        'checksum_sha256',
        'size_bytes',
        'project_id',
        'server_id',
        'bucket',
        'storage_id',
      ],
    ),
  )
  const environments = await store.all(
    jsonRows(
      sql`select id, project_id, runtime_id, status from environments
    where project_id in (${projectIds}) order by id limit 101`,
      ['id', 'project_id', 'runtime_id', 'status'],
    ),
  )
  return {
    target,
    id,
    status: row.status,
    jobs: recoveryRows(jobs),
    artifacts: recoveryRows(artifacts),
    environments: recoveryRows(environments),
    note: 'Each list is limited to 101 rows. Inspect individual IDs; never treat this as a complete archive inventory.',
  }
}

export function deletionRecoveryPlan(input: {
  action: RecoveryAction
  row: Row
  operator: string
  reason: string
  now: Date
}): [SQL, ...SQL[]] {
  const { action, row, now } = input
  if (!input.operator.trim() || !input.reason.trim())
    throw new RecoveryInputError('Operator and evidence/reason are required.')
  const id = String(row.id),
    time = now.getTime()
  const resolution = JSON.stringify({
    kind: 'confirmed-cleanup',
    operator: input.operator,
    reason: input.reason,
    at: time,
  })
  const statements: SQL[] = []
  let guard: SQL
  let team: SQL
  if (action === 'cleanup-project') {
    if (row.status !== 'deleted')
      throw new RecoveryInputError('Only deleted projects can be cleaned up.')
    guard = sql`exists(select 1 from projects where id = ${id} and status = 'deleted' and updated_at = ${row.updated_at}
      and exists(select 1 from environments where project_id = ${id} and status <> 'deleted'))`
    team = sql`select team_id from projects where id = ${id}`
    statements.push(
      runtimeCleanupInsert({
        projectIds: sql`select id from projects where id = ${id}`,
        projectId: id,
        guard,
        reason: `Operator ${input.operator}: ${input.reason}`,
        now,
      }),
    )
    statements.push(sql`update environments set status = 'deleted', is_production = 0, updated_at = ${time}
      where project_id = ${id} and ${guard}`)
  } else if (action === 'confirm-artifact') {
    guard = sql`exists(select 1 from backup_artifacts a join backup_runs r on r.id = a.backup_run_id
      join projects p on p.id = r.project_id where a.id = ${id} and p.status = 'deleted'
      and a.object_key = ${row.object_key} and a.checksum_sha256 = ${row.checksum_sha256}
      and a.backup_run_id = ${row.backup_run_id} and a.storage = ${row.storage}
      and r.status not in ('queued','running') and r.cleanup_queued_at is null)`
    team = sql`select p.team_id from projects p join backup_runs r on r.project_id = p.id where r.id = ${row.backup_run_id}`
    statements.push(sql`update backup_runs set manifest = json_set(coalesce(manifest, '{}'), '$.operatorRecovery', json(${resolution})),
      updated_at = ${time} where id = ${row.backup_run_id} and ${guard}`)
    statements.push(
      sql`delete from backup_artifacts where id = ${id} and ${guard}`,
    )
  } else {
    const cleanup = row.type === 'deprovision' || row.type === 'purge'
    if (row.status === 'succeeded')
      throw new RecoveryInputError('This job has already completed.')
    const staleCleanup =
      cleanup &&
      row.status === 'running' &&
      (row.claimed_at === null ||
        Number(row.claimed_at) < time - 60 * 60 * 1000)
    if (row.status === 'running' && !staleCleanup)
      throw new RecoveryInputError(
        'Wait for the running job to finish or become stale before recovery.',
      )
    if (action === 'retry-job' && !cleanup)
      throw new RecoveryInputError(
        'Only container cleanup jobs can be retried; do not replay deployments, backups or restores.',
      )
    if (
      action === 'retry-job' &&
      row.status !== 'failed' &&
      row.status !== 'abandoned' &&
      row.status !== 'canceled' &&
      !staleCleanup
    )
      throw new RecoveryInputError(
        'Only terminal unsuccessful cleanup jobs can be retried.',
      )
    guard = sql`exists(select 1 from agent_jobs j where j.id = ${id} and j.status = ${row.status}
      and j.type = ${row.type} and j.server_id = ${row.server_id}
      and j.project_id is ${row.project_id ?? null} and j.team_id is ${row.team_id ?? null}
      and j.available_at = ${row.available_at} and j.attempt = ${row.attempt} and j.claimed_at is ${row.claimed_at ?? null} and j.updated_at = ${row.updated_at} and j.payload = ${row.payload}
      and (exists(select 1 from projects p where p.id = j.project_id and p.status = 'deleted')
        or exists(select 1 from servers s where s.id = j.server_id and s.status = 'deleted')
        or exists(select 1 from teams t where t.id = j.team_id and t.status = 'deleted')))`
    team = sql`select coalesce(j.team_id, p.team_id, s.team_id) from agent_jobs j
      left join projects p on p.id = j.project_id join servers s on s.id = j.server_id where j.id = ${id}`
    if (action === 'retry-job') {
      statements.push(sql`update agent_jobs set status = 'queued', claimed_at = null, finished_at = null,
        available_at = max(available_at, ${time}), updated_at = ${time}, max_attempts = max(max_attempts, attempt + 10),
        error_message = null, payload = json_set(payload, '$.operatorRetry', json(${resolution})) where id = ${id} and ${guard}`)
    } else {
      if (row.type === 'backup_cleanup')
        statements.push(sql`update backup_runs set cleanup_queued_at = null, cleanup_error_message = null, updated_at = ${time}
          where project_id = ${row.project_id} and server_id = ${row.server_id}
          and id in (select value from json_each(${String(row.payload)}, '$.backupRunIds')) and ${guard}`)
      if (row.type === 'backup')
        statements.push(sql`update backup_runs set status = 'canceled', finished_at = ${time}, updated_at = ${time}
          where id = json_extract(${String(row.payload)}, '$.backupRunId') and project_id = ${row.project_id}
          and server_id = ${row.server_id} and status in ('queued','running') and ${guard}`)
      // A confirmed cleanup is a real success; failed executions remain canceled,
      // with an explicit operator resolution instead of a fabricated backup success.
      statements.push(sql`update agent_jobs set status = ${cleanup ? 'succeeded' : 'canceled'},
        finished_at = ${time}, updated_at = ${time}, error_message = ${`Operator resolution: ${input.reason}`},
        payload = json_set(payload, '$.operatorResolution', json(${resolution})) where id = ${id} and ${guard}`)
    }
  }
  const audit = sql`insert into api_audit (id, team_id, user_id, credential_id, request_id, operation, resource_id, outcome, created_at)
    select ${crypto.randomUUID()}, coalesce((${team}), 'installation'), ${input.operator}, 'operator-cli',
      ${crypto.randomUUID()}, ${`deletion.${action}`}, ${id}, 'succeeded', ${time} where ${guard} returning id`
  return [audit, ...statements]
}
