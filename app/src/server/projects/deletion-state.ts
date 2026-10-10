import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import { runtimeCleanupInsert } from '@/server/agents/cleanup'

export async function deleteProjectState(
  store: AtomicStore,
  input: {
    projectId: string
    teamId: string
    userId: string
    removeDeployments: boolean
    now: Date
  },
) {
  const now = input.now.getTime()
  const guard = sql`exists(select 1 from projects p join teams t on t.id = p.team_id
    join team_members m on m.team_id = t.id join user u on u.id = m.user_id
    where p.id = ${input.projectId} and p.team_id = ${input.teamId} and p.status = 'active'
      and t.status = 'active' and u.status = 'active' and m.user_id = ${input.userId}
      and m.role in ('owner', 'admin'))`
  const envIds = sql`select id from environments where project_id = ${input.projectId}`
  const message = 'Canceled because the project was deleted.'
  const results = await store.batch([
    store.run(sql`update agent_jobs set status = 'canceled', error_message = ${message},
      finished_at = ${now}, updated_at = ${now} where project_id = ${input.projectId}
      and type in ('deploy', 'backup', 'restore', 'backup_cleanup') and status in ('queued', 'running') and ${guard}`),
    ...(input.removeDeployments
      ? [
          store.run(
            runtimeCleanupInsert({
              projectIds: sql`select id from projects where id = ${input.projectId}`,
              projectId: input.projectId,
              guard,
              reason: 'Project deleted.',
              now: input.now,
            }),
          ),
        ]
      : []),
    store.run(sql`update backup_runs set status = 'canceled', error_message = ${message},
      finished_at = ${now}, updated_at = ${now} where project_id = ${input.projectId}
      and status in ('queued', 'running') and ${guard}`),
    ...(input.removeDeployments
      ? [
          store.run(sql`update environments set status = 'deleted',
      is_production = 0, updated_at = ${now} where project_id = ${input.projectId} and ${guard}`),
        ]
      : []),
    store.run(sql`update deployments set status = 'canceled', phase = 'canceled', error_message = ${message},
      finished_at = ${now} where environment_id in (${envIds}) and status in ('queued', 'running') and ${guard}`),
    store.run(
      sql`delete from aliases where project_id = ${input.projectId} and ${guard}`,
    ),
    store.run(
      sql`delete from domains where project_id = ${input.projectId} and ${guard}`,
    ),
    store.all(sql`update projects set status = 'deleted', updated_at = ${now} where id = ${input.projectId}
      and ${guard} returning id`),
  ])
  const changed = results.at(-1)
  return Array.isArray(changed) && changed.length === 1
}
