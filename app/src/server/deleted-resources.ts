import { sql } from 'drizzle-orm'
import { removeOwnedAvatar } from '@/server/uploads/avatar'
import { db } from '@/server/db'
import type { AtomicStore } from '@/server/db/atomic'

// Keep terminal job records long enough for an agent to retry a lost acknowledgement.
// Unresolved external resources are never treated as successfully cleaned up.
export const deletedResourceRetentionMs = 30 * 24 * 60 * 60 * 1000

const resolvedJob = sql`(status = 'succeeded' or (status = 'canceled' and type not in ('deprovision', 'purge') and (attempt = 0
  or json_extract(case when json_valid(payload) then payload else '{}' end, '$.operatorResolution.kind') = 'confirmed-cleanup')))`

export async function pruneDeletedResources({
  store = db,
  now = new Date(),
  limit = 100,
}: {
  store?: AtomicStore
  now?: Date
  limit?: number
} = {}) {
  const cutoff = now.getTime() - deletedResourceRetentionMs
  const batchLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
  // Keep the owning row if object storage is unavailable, so a later sweep
  // can retry rather than losing the only reference to an uploaded avatar.
  for (const table of ['projects', 'teams'] as const) {
    const rows =
      await store.all(sql`select id, avatar_path from ${sql.raw(table)}
      where status = 'deleted' and updated_at <= ${cutoff} and avatar_path is not null
      order by id limit ${batchLimit}`)
    for (const row of rows) {
      const values = Array.isArray(row)
        ? row
        : Object.values(row as Record<string, unknown>)
      const [id, path] = values
      if (typeof id !== 'string' || typeof path !== 'string')
        throw new Error('Invalid deleted avatar row.')
      try {
        await removeOwnedAvatar(
          path,
          {
            filePrefix: table === 'projects' ? 'project' : 'team',
            resourceId: id,
          },
          { strict: true },
        )
        await store.run(sql`update ${sql.raw(table)} set avatar_path = null where id = ${id}
          and status = 'deleted' and avatar_path = ${path}`)
      } catch {
        console.error('Unable to remove deleted resource avatar.', {
          resourceId: id,
          table,
        })
      }
    }
  }
  const unprovisionedProjects = sql`select id from projects where status = 'deleted'
    and (exists(select 1 from aliases a where a.project_id = projects.id)
      or exists(select 1 from domains d where d.project_id = projects.id))
    and not exists(select 1 from environments e where e.project_id = projects.id and e.status <> 'deleted')
    and not exists(select 1 from agent_jobs j where j.type = 'deprovision' and j.status <> 'succeeded'
      and (j.project_id = projects.id or (j.team_id = projects.team_id and j.project_id is null)))
    order by id limit ${batchLimit}`
  await store.batch([
    store.run(
      sql`delete from aliases where project_id in (${unprovisionedProjects})`,
    ),
    store.run(
      sql`delete from domains where project_id in (${unprovisionedProjects})`,
    ),
  ])
  const expiredJobs = sql`${resolvedJob} and coalesce(finished_at, updated_at) <= ${cutoff}`
  const projectEligible = sql`avatar_path is null and status = 'deleted' and updated_at <= ${cutoff}
    and not exists(select 1 from environments e where e.project_id = projects.id and e.status <> 'deleted')
    and not exists(select 1 from backup_runs r where r.project_id = projects.id and (
      r.status in ('queued', 'running') or r.cleanup_queued_at is not null
      or exists(select 1 from backup_artifacts a where a.backup_run_id = r.id)))
    and not exists(select 1 from agent_jobs j where
      (j.project_id = projects.id or (j.team_id = projects.team_id and j.project_id is null))
      and not (${expiredJobs}))`
  const serverEligible = sql`status = 'deleted' and updated_at <= ${cutoff}
    and not exists(select 1 from projects p where p.default_server_id = servers.id)
    and not exists(select 1 from environments e where e.server_id = servers.id)
    and not exists(select 1 from deployments d where d.server_id = servers.id)
    and not exists(select 1 from backup_runs r where r.server_id = servers.id)
    and not exists(select 1 from agent_jobs j where j.server_id = servers.id and not (${expiredJobs}))
    and not exists(select 1 from agent_runtime_observations o where o.server_id = servers.id
      and not exists(select 1 from agent_jobs j,
        json_each(case when json_valid(j.payload) then j.payload else '{}' end, '$.runtimeIds') target
        where j.server_id = servers.id and j.type = 'purge' and j.status = 'succeeded'
          and j.finished_at >= o.last_seen_at and target.value = o.runtime_id))`
  // No asynchronous reads authorize a delete. Each mutation repeats its guard in
  // the atomic batch; foreign-key cascades then remove owned settings/credentials.
  const projectIds = sql`select id from projects where ${projectEligible} order by id limit ${batchLimit}`
  const serverIds = sql`select id from servers where ${serverEligible} order by id limit ${batchLimit}`
  const teamEligible = sql`avatar_path is null and status = 'deleted' and updated_at <= ${cutoff}
    and not exists(select 1 from projects p where p.team_id = teams.id)
    and not exists(select 1 from servers s where s.team_id = teams.id)
    and not exists(select 1 from agent_jobs j where j.team_id = teams.id and not (${expiredJobs}))`
  const teamIds = sql`select id from teams where ${teamEligible} order by id limit ${batchLimit}`
  const userEligible = sql`status = 'deleted' and updated_at <= ${cutoff}
    and not exists(select 1 from team_members m where m.user_id = user.id)
    and exists(select 1 from user_cleanup_jobs j where j.user_id = user.id and j.status = 'succeeded')
    and not exists(select 1 from user_cleanup_jobs j where j.user_id = user.id and j.status <> 'succeeded')`
  const results = await store.batch([
    store.run(
      sql`delete from agent_jobs where project_id in (${projectIds}) and ${expiredJobs}
        and exists(select 1 from servers s where s.id = agent_jobs.server_id and s.status <> 'deleted')`,
    ),
    store.all(
      sql`delete from projects where id in (${projectIds}) returning id`,
    ),
    store.run(
      sql`delete from agent_runtime_observations where server_id in (${serverIds})`,
    ),
    store.run(
      sql`delete from agent_jobs where server_id in (${serverIds}) and ${expiredJobs}`,
    ),
    store.all(sql`delete from servers where id in (${serverIds}) returning id`),
    store.run(
      sql`delete from agent_jobs where team_id in (${teamIds}) and ${expiredJobs}`,
    ),
    store.all(sql`delete from teams where id in (${teamIds}) returning id`),
    store.all(sql`delete from user where id in (select id from user where ${userEligible}
      order by id limit ${batchLimit}) returning id`),
  ])
  return {
    projects: results[1].length,
    servers: results[4].length,
    teams: results[6].length,
    users: results[7].length,
  }
}
