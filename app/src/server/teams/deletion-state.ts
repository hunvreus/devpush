import { releaseBackupCleanupRuns } from '@/server/backups/queue-state'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import { runtimeCleanupInsert } from '@/server/agents/cleanup'

export function teamDeletionStatements(input: {
  teamIds: SQL
  guard: SQL
  reason: string
  message: string
  now: Date
  clearDefaults?: boolean
}): [SQL, ...SQL[]] {
  const now = input.now.getTime()
  const projects = sql`select id from projects where team_id in (${input.teamIds})`
  const servers = sql`select id from servers where team_id in (${input.teamIds})`
  const environments = sql`select id from environments where project_id in (${projects})`
  return [
    releaseBackupCleanupRuns({
      jobIds: sql`select id from agent_jobs where server_id in (${servers})`,
      guard: input.guard,
      message: input.message,
      now: input.now,
    }),
    sql`update agent_jobs set status = 'canceled', error_message = ${input.message}, finished_at = ${now}, updated_at = ${now}
      where server_id in (${servers}) and type in ('deploy', 'backup', 'restore', 'backup_cleanup')
      and status in ('queued', 'running') and ${input.guard}`,
    sql`update backup_runs set status = 'canceled', error_message = ${input.message}, finished_at = ${now}, updated_at = ${now}
      where server_id in (${servers}) and status in ('queued', 'running') and ${input.guard}`,
    runtimeCleanupInsert({
      projectIds: projects,
      guard: input.guard,
      reason: input.reason,
      now: input.now,
    }),
    sql`update environments set status = 'deleted', is_production = 0, updated_at = ${now}
      where project_id in (${projects}) and ${input.guard}`,
    sql`update deployments set status = 'canceled', phase = 'canceled', error_message = ${input.message}, finished_at = ${now}
      where environment_id in (${environments}) and status in ('queued', 'running') and ${input.guard}`,
    sql`update projects set status = 'deleted', updated_at = ${now} where team_id in (${input.teamIds}) and ${input.guard}`,
    sql`update servers set status = 'deleted', updated_at = ${now} where team_id in (${input.teamIds}) and ${input.guard}`,
    ...(input.clearDefaults
      ? [
          sql`update user set default_team_id = null, updated_at = ${now}
      where default_team_id in (${input.teamIds}) and ${input.guard}`,
        ]
      : []),
    sql`update teams set status = 'deleted', updated_at = ${now} where id in (${input.teamIds}) and ${input.guard} returning id`,
  ]
}

export async function deleteTeamState(
  store: AtomicStore,
  input: {
    teamId: string
    userId: string
    now: Date
  },
) {
  const guard = sql`exists(select 1 from teams t join team_members m on m.team_id = t.id
    join user u on u.id = m.user_id where t.id = ${input.teamId} and t.status = 'active'
      and m.user_id = ${input.userId} and m.role = 'owner' and u.status = 'active')
    and not exists(select 1 from user where default_team_id = ${input.teamId} and status = 'active')`
  const [first, ...rest] = teamDeletionStatements({
    teamIds: sql`select id from teams where id = ${input.teamId}`,
    guard,
    reason: 'Team deleted.',
    message: 'Canceled because the team was deleted.',
    now: input.now,
  })
  const results = await store.batch([
    store.run(first),
    ...rest.map((query, index) =>
      index === rest.length - 1 ? store.all(query) : store.run(query),
    ),
  ])
  const changed = results.at(-1)
  return Array.isArray(changed) && changed.length === 1
}
