import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

export type DeprovisionJobPayload = {
  schemaVersion: 1
  runtimeIds: string[]
  removeVolumes: boolean
  reason: string
}

export const cleanupVolumeRetentionMs = 7 * 24 * 60 * 60 * 1000

// Derive targets inside the caller's deletion batch. One noisy project cannot
// produce an unbounded agent payload; every target is kept in a chunk of 200.
export function runtimeCleanupInsert(input: {
  projectIds: SQL
  guard: SQL
  projectId?: string
  reason: string
  now: Date
}) {
  const now = input.now.getTime()
  return sql`with targets as materialized (
    select p.team_id, trim(coalesce(e.server_id, p.default_server_id)) as server_id,
      trim(e.runtime_id) as runtime_id
    from environments e join projects p on p.id = e.project_id
    where p.id in (${input.projectIds}) and ${input.guard}
    union
    select p.team_id, trim(d.server_id), trim(d.runtime_id)
    from deployments d join environments e on e.id = d.environment_id
      join projects p on p.id = e.project_id
    where p.id in (${input.projectIds}) and ${input.guard}
  ), numbered as (
    select *, (row_number() over (partition by team_id, server_id order by runtime_id) - 1) / 200 as chunk
    from targets where server_id is not null and server_id <> '' and runtime_id <> ''
  ), groups as (
    select team_id, server_id, chunk, json_group_array(runtime_id) as runtime_ids
    from (select * from numbered order by team_id, server_id, chunk, runtime_id)
    group by team_id, server_id, chunk
  ), kinds as (select 'deprovision' as type union all select 'purge')
  insert into agent_jobs
    (id, type, status, server_id, team_id, project_id, payload, max_attempts, available_at, created_at, updated_at)
  select lower(hex(randomblob(16))), kinds.type, 'queued', groups.server_id, groups.team_id,
    ${input.projectId ?? null},
    json_object('schemaVersion', 1, 'runtimeIds', json(groups.runtime_ids),
      'removeVolumes', json(case when kinds.type = 'purge' then 'true' else 'false' end),
      'reason', case when kinds.type = 'purge'
        then ${`${input.reason} Purge retained volumes after the retention window.`} else ${input.reason} end),
    10, case when kinds.type = 'purge' then ${now + cleanupVolumeRetentionMs} else ${now} end,
    ${now}, ${now}
  from groups cross join kinds`
}
