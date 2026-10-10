import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import {
  agentJobs,
  agentRuntimeObservations,
  deployments,
  environments,
  projects,
} from '@/server/db/schema'
import { cleanupVolumeRetentionMs } from './cleanup'
import type { ReportedRuntime } from './reconciliation'

export async function reconcileRuntimeState(
  store: AtomicStore,
  input: {
    serverId: string
    runtimeIds: string[]
    runtimes: ReportedRuntime[]
    now: Date
  },
) {
  const now = input.now.getTime()
  const services = new Map(
    input.runtimes.map((runtime) => [runtime.runtimeId, runtime.services]),
  )
  const reportedServices = JSON.stringify([...services.keys()])
  const observations = []
  for (let offset = 0; offset < input.runtimeIds.length; offset += 8) {
    const rows = input.runtimeIds.slice(offset, offset + 8).map(
      (runtimeId) => sql`(
      ${crypto.randomUUID()}, ${input.serverId}, ${runtimeId},
      ${services.has(runtimeId) ? JSON.stringify(services.get(runtimeId)) : null}, ${now}, ${now}, ${now}, ${now})`,
    )
    observations.push(
      store.run(sql`insert into ${agentRuntimeObservations}
      (id, server_id, runtime_id, services, first_seen_at, last_seen_at, created_at, updated_at)
      values ${sql.join(rows, sql`, `)} on conflict(server_id, runtime_id) do update set
      last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at,
      services = case when runtime_id in (select value from json_each(${reportedServices}))
        then excluded.services else services end`),
    )
  }
  // Decide whether a runtime is still needed inside the same write batch that
  // enqueues cleanup. Assignment or deployment changes cannot race this check.
  const orphan = sql`substr(ob.runtime_id, 1, 3) = 'dp_'
    and not exists(select 1 from ${environments} as env join ${projects} as project on project.id = env.project_id
      where env.runtime_id = ob.runtime_id and env.status = 'active'
        and coalesce(env.server_id, project.default_server_id) = ${input.serverId})
    and not exists(select 1 from ${deployments} as deployment
      where deployment.runtime_id = ob.runtime_id and deployment.server_id = ${input.serverId}
        and deployment.status in ('queued', 'running'))
    and not exists(select 1 from ${agentJobs} as job
      where job.server_id = ${input.serverId} and job.type in ('deprovision', 'purge')
        and job.status in ('queued', 'running') and json_type(job.payload, '$.runtimeIds') = 'array'
        and exists(select 1 from json_each(job.payload, '$.runtimeIds') as runtime
          where runtime.type = 'text' and runtime.value = ob.runtime_id))`
  const cleanupId = crypto.randomUUID()
  const purgeId = crypto.randomUUID()
  const queue = (
    id: string,
    type: 'deprovision' | 'purge',
    eligible: SQL,
    reason: string,
  ) =>
    store.run(sql`
    insert into ${agentJobs} (id, type, status, server_id, payload, max_attempts, available_at, created_at, updated_at)
    select ${id}, ${type}, 'queued', ${input.serverId},
      json_object('schemaVersion', 1, 'runtimeIds', json_group_array(runtime_id),
        'removeVolumes', json(${type === 'purge' ? 'true' : 'false'}), 'reason', ${reason}),
      10, ${now}, ${now}, ${now}
    from (select ob.runtime_id from ${agentRuntimeObservations} as ob
      where ob.server_id = ${input.serverId} and ${eligible} and ${orphan} order by ob.runtime_id limit 200)
    having count(*) > 0`)
  const cleanup = queue(
    cleanupId,
    'deprovision',
    sql`ob.cleanup_queued_at is null and ob.first_seen_at <= ${now - 10 * 60 * 1000}
      and ob.runtime_id in (select value from json_each(${JSON.stringify(input.runtimeIds)}))`,
    'devpush detected a Compose runtime that is no longer assigned.',
  )
  const markCleanup =
    store.all(sql`update ${agentRuntimeObservations} set cleanup_queued_at = ${now}, updated_at = ${now}
    where server_id = ${input.serverId} and runtime_id in (
      select runtime.value from ${agentJobs} as job, json_each(job.payload, '$.runtimeIds') as runtime where job.id = ${cleanupId})
    returning runtime_id`)
  const purge = queue(
    purgeId,
    'purge',
    sql`ob.cleanup_queued_at <= ${now - cleanupVolumeRetentionMs} and ob.purge_queued_at is null`,
    'devpush detected retained volumes for a Compose runtime that is no longer assigned.',
  )
  const markPurge =
    store.all(sql`update ${agentRuntimeObservations} set purge_queued_at = ${now}, updated_at = ${now}
    where server_id = ${input.serverId} and runtime_id in (
      select runtime.value from ${agentJobs} as job, json_each(job.payload, '$.runtimeIds') as runtime where job.id = ${purgeId})
    returning runtime_id`)
  const tail = [cleanup, markCleanup, purge, markPurge] as const
  const [first, ...rest] = observations
  const results = first
    ? await store.batch([first, ...rest, ...tail])
    : await store.batch(tail)
  const runtimeIds: string[] = []
  for (const result of [results.at(-3), results.at(-1)]) {
    if (!Array.isArray(result))
      throw new Error('Invalid runtime reconciliation result.')
    for (const row of result as unknown[]) {
      const id = Array.isArray(row)
        ? row[0]
        : typeof row === 'object' && row !== null && 'runtime_id' in row
          ? row.runtime_id
          : undefined
      if (typeof id !== 'string')
        throw new Error('Invalid runtime reconciliation result.')
      runtimeIds.push(id)
    }
  }
  return runtimeIds
}
